// Final document numbers for offline work.
//
// The device holds pre-reserved, contiguous number blocks per document kind, allocated atomically by the
// server from the company's single counter (POST /numbers/reserve). Creating a document stamps the next
// free number of the pool LOCALLY — this is the document's final number, saved with it and never changed
// after sync. The pool is persisted BEFORE the number is handed out, so a crash or app kill can only ever
// leave a gap, never a duplicate. Takes are serialized (mutex) so two quick saves can't share a number.
// The server re-validates every number on sync (range belongs to this user + not used yet).
import { api } from "@/src/api";
import { storage } from "@/src/utils/storage";

export type DocKind = "sale" | "col" | "ret" | "pay" | "wret";
const KINDS: DocKind[] = ["sale", "col", "ret", "pay", "wret"];
const PREFIX: Record<DocKind, string> = { sale: "INV", col: "RCV", ret: "RET", pay: "PAY", wret: "WRT" };
// Mirrors convex/lib.ts BLOCK_SIZE; refill once fewer than half a block is left.
const SIZE: Record<DocKind, number> = { sale: 40, col: 40, ret: 10, pay: 10, wret: 5 };

type Block = { id: string; kind: DocKind; start: number; end: number; taken: number[] };
type Pool = { blocks: Block[] };

const DEVICE_KEY = "doc_device_uid";
let owner: string | null = null;
let pool: Pool = { blocks: [] };
let loaded: Promise<void> | null = null;
let chain: Promise<unknown> = Promise.resolve();
let refilling: Promise<void> | null = null;

const poolKey = () => `doc_number_pool:${owner}`;
export const fmtDocNo = (kind: DocKind, n: number) => `${PREFIX[kind]}-${String(n).padStart(5, "0")}`;

async function deviceId() {
  let d = await storage.getItem<string>(DEVICE_KEY, null as any);
  if (!d) {
    d = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}${Math.random().toString(36).slice(2, 8)}`;
    await storage.setItem(DEVICE_KEY, d);
  }
  return String(d);
}

function load() {
  if (!loaded) {
    loaded = (async () => {
      const raw = owner ? await storage.getItem<any>(poolKey(), null) : null;
      pool = raw && Array.isArray(raw.blocks) ? raw : { blocks: [] };
    })();
  }
  return loaded;
}
const persist = () => storage.setItem(poolKey(), pool as any);
const free = (b: Block) => b.end - b.start + 1 - b.taken.length;
const remaining = (kind: DocKind) => pool.blocks.filter((b) => b.kind === kind).reduce((s, b) => s + free(b), 0);

// Pool is per signed-in user (and per device); call whenever the session user is known.
export function setNumberOwner(user: { user_id?: string; org_id?: string | null } | null) {
  const next = user?.user_id && user.org_id ? `${user.org_id}:${user.user_id}` : null;
  if (next === owner) return;
  owner = next;
  loaded = null;
  pool = { blocks: [] };
  if (owner) refillNumbers();
}

// Top up every kind from the server (no-op offline / signed out). Safe to call often.
export function refillNumbers(): Promise<void> {
  if (!owner) return Promise.resolve();
  if (refilling) return refilling;
  const me = owner;
  refilling = (async () => {
    try {
      await load();
      const server = await api<any[]>("/numbers/reserve", { method: "POST", body: { device_id: await deviceId(), kinds: KINDS } });
      if (me !== owner) return;
      // Merge under the mutex so it never races a take.
      await (chain = chain.then(async () => {
        const local = new Map(pool.blocks.map((b) => [b.id, b]));
        // The server lists every block of this device that still has numbers it hasn't seen used.
        // Locally-taken numbers (not synced yet) are kept; server-used ones are added.
        pool.blocks = server.map((s) => {
          const l = local.get(s.id);
          return { id: s.id, kind: s.kind, start: s.start, end: s.end, taken: [...new Set([...(l?.taken ?? []), ...(s.used ?? [])])] };
        });
        pool.blocks = pool.blocks.filter((b) => free(b) > 0);
        await persist();
      }));
    } catch {
      // Offline or server unreachable: keep the current pool; we'll retry on the next trigger.
    } finally {
      refilling = null;
    }
  })();
  return refilling;
}

// Next FINAL number for a new document of `kind`. Throws only if the device has no reserved
// numbers left AND the server can't be reached to reserve more.
export function takeDocNumber(kind: DocKind): Promise<string> {
  const run = async (): Promise<string | null> => {
    await load();
    // Re-read the persisted pool so another tab/instance's takes are seen (never hand out a taken number).
    const fresh = owner ? await storage.getItem<any>(poolKey(), null) : null;
    if (fresh && Array.isArray(fresh.blocks)) {
      const mine = new Map(pool.blocks.map((b) => [b.id, b]));
      pool.blocks = fresh.blocks.map((b: Block) => ({ ...b, taken: [...new Set([...(mine.get(b.id)?.taken ?? []), ...b.taken])] }));
    }
    const b = pool.blocks.filter((x) => x.kind === kind && free(x) > 0).sort((x, y) => x.start - y.start)[0];
    if (!b) return null;
    const used = new Set(b.taken);
    let n = b.start;
    while (used.has(n)) n++;
    b.taken.push(n);
    await persist(); // persisted before use → a crash can never hand out the same number twice
    return fmtDocNo(kind, n);
  };
  const p = (chain = chain.then(run, run)) as Promise<string | null>;
  return p.then(async (no) => {
    if (no) {
      if (remaining(kind) < SIZE[kind] / 2) refillNumbers();
      return no;
    }
    await refillNumbers();
    const again = await (chain = chain.then(run, run)) as string | null;
    if (!again) throw new Error("لا توجد أرقام مستندات محجوزة على هذا الجهاز — اتصل بالإنترنت مرة واحدة لحجز أرقام جديدة");
    return again;
  });
}

export async function numbersLeft() {
  await load();
  return Object.fromEntries(KINDS.map((k) => [k, remaining(k)])) as Record<DocKind, number>;
}
