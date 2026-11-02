// Offline support: local cache of GET responses + a persistent queue of
// write actions (sales, collections, returns, customers) synced to the server.
//
// Scalability + conflict strategy (reconnect / large backlogs):
//   - Items keep insertion order per endpoint (`path`) so dependent writes
//     against the same route land in the order the user made them, while
//     different endpoints flush in PARALLEL (bounded concurrency).
//   - Every item is sent with its client-generated `id` in the body. The
//     Convex mutations are id-idempotent: re-sending the same `id` returns
//     the existing doc (see e.g. sales.create → docOrgUnique). Safe to retry.
//   - Transient failures (network / 5xx / 429 / timeout) are retried with
//     exponential backoff (max 5 attempts, 1s → 16s, +/-25% jitter) and
//     persist across app restarts. Permanent failures (4xx with Arabic
//     server message) go straight to the "failed" tray for user review.
//   - 409 CONFLICT is treated as "server is authoritative": the pending
//     optimistic row is dropped from the cache and the next GET refetches
//     the server's canonical state. No data loss (the user still has the
//     failed-item in the tray with the server message, so they can retry
//     or discard).
//   - Progress ({done,total}) is exposed via useSyncState for the UI.
import NetInfo from "@react-native-community/netinfo";
import { useEffect, useState } from "react";

import { api } from "@/src/api";
import { queryClient } from "@/src/query-client";
import { storage } from "@/src/utils/storage";

export type QItem = {
  id: string;
  path: string;
  body: any;
  label: string;
  // Transient attempt counter — survives app restarts.
  attempts?: number;
  // Earliest next-send time (ISO) for backoff.
  next_attempt_at?: string;
  error?: string;
  // Set when the server answered 409 (its data won; the local change was not applied).
  conflict?: boolean;
  created_at: string;
};

const Q_KEY = "offline_queue";
const F_KEY = "offline_failed";
const IDX_KEY = "offline_cache_index";
const H_KEY = "offline_synced_history";
const HISTORY_MAX = 200;

// Successfully synced items (newest first) — powers the distributor's sync report.
export type SyncedItem = { id: string; label: string; path: string; created_at: string; synced_at: string };

// Bounded concurrency: send up to N requests in parallel across different
// endpoints. Same-endpoint writes still run strictly serially so dependent
// mutations against the same resource flush in the order the user made them.
const PARALLEL = 6;
const MAX_ATTEMPTS = 5;
// Backoff: 1s, 2s, 4s, 8s, 16s (with +/-25% jitter).
const BACKOFF_BASE_MS = 1000;
const BACKOFF_CAP_MS = 30000;

let queue: QItem[] = [];
let failed: QItem[] = [];
let history: SyncedItem[] = [];
let lastSyncAt: string | null = null;
let loaded: Promise<void> | null = null;
let syncing = false;
let online = true;
let progress = { done: 0, total: 0 };
const listeners = new Set<() => void>();
// Fires once per flush that successfully synced items — payload is the number
// of items that landed on the server in this batch. Used by UI (SyncBanner) to
// pop a quiet "تمت المزامنة" toast after large reconnect catch-ups.
const completeListeners = new Set<(synced: number) => void>();
const notify = () => listeners.forEach((f) => f());
export function onSyncComplete(fn: (synced: number) => void) {
  completeListeners.add(fn);
  return () => completeListeners.delete(fn);
}

const parse = (raw: unknown, fb: any) => {
  try {
    return raw ? JSON.parse(String(raw)) : fb;
  } catch {
    return fb;
  }
};

function load() {
  if (!loaded) {
    loaded = (async () => {
      queue = parse(await storage.getItem(Q_KEY, null), []);
      failed = parse(await storage.getItem(F_KEY, null), []);
      history = parse(await storage.getItem(H_KEY, null), []);
      notify();
    })();
  }
  return loaded;
}

async function save() {
  await storage.setItem(Q_KEY, JSON.stringify(queue));
  await storage.setItem(F_KEY, JSON.stringify(failed));
  notify();
}
// Persist the queue without re-saving the (potentially large) failed list.
// Used after every in-flight item so partial progress survives a crash.
async function saveQueueOnly() {
  await storage.setItem(Q_KEY, JSON.stringify(queue));
  notify();
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
export const pendingCount = () => queue.length;

// ---------------- Cache ----------------
// Organization identity (profile + logo/stamp) is cached ENCRYPTED: the cipher key lives in the
// device Keychain / Keystore (storage.secure*), the ciphertext in regular storage. Invoices can
// therefore always be branded, online or offline.
const SECURE_PATHS = new Set(["/org/profile", "/org/logo"]);
let cipherKey: Promise<number[]> | null = null;
function getKey() {
  if (!cipherKey)
    cipherKey = (async () => {
      let k = await storage.secureGet<string>("org_cache_key", "");
      if (!k) {
        k = Array.from({ length: 32 }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, "0")).join("");
        await storage.secureSet("org_cache_key", k);
      }
      return k.match(/../g)!.map((h) => parseInt(h, 16));
    })();
  return cipherKey;
}
// xorshift128 keystream seeded from the 256-bit device key; text is UTF-16 code units.
function xcrypt(text: string, key: number[]) {
  let [a, b, c, d] = [0, 1, 2, 3].map((i) => ((key[i * 4] << 24) | (key[i * 4 + 1] << 16) | (key[i * 4 + 2] << 8) | key[i * 4 + 3]) >>> 0 || 0x9e3779b9);
  let out = "";
  for (let i = 0; i < text.length; i++) {
    let t = a ^ (a << 11);
    a = b; b = c; c = d;
    d = (d ^ (d >>> 19) ^ (t ^ (t >>> 8))) >>> 0;
    out += String.fromCharCode(text.charCodeAt(i) ^ (d & 0xffff));
  }
  return out;
}
const toB64 = (s: string) => { const b: string[] = []; for (let i = 0; i < s.length; i++) b.push(String.fromCharCode(s.charCodeAt(i) >> 8, s.charCodeAt(i) & 255)); return btoa(b.join("")); };
const fromB64 = (s: string) => { const r = atob(s); let o = ""; for (let i = 0; i + 1 < r.length; i += 2) o += String.fromCharCode((r.charCodeAt(i) << 8) | r.charCodeAt(i + 1)); return o; };

export async function readCache<T = any>(path: string): Promise<T | null> {
  const raw: any = await storage.getItem(`cache:${path}`, null);
  if (SECURE_PATHS.has(path) && typeof raw === "string" && raw.startsWith("enc:")) {
    try {
      return JSON.parse(xcrypt(fromB64(raw.slice(4)), await getKey()));
    } catch {
      return null;
    }
  }
  return parse(raw, null);
}

export async function writeCache(path: string, data: unknown) {
  const json = JSON.stringify(data);
  await storage.setItem(`cache:${path}`, SECURE_PATHS.has(path) ? `enc:${toB64(xcrypt(json, await getKey()))}` : json);
  const idx: string[] = parse(await storage.getItem(IDX_KEY, null), []);
  if (!idx.includes(path)) await storage.setItem(IDX_KEY, JSON.stringify([...idx, path]));
}

export async function updateCached<T = any>(path: string, fn: (cur: T) => T) {
  const cur = (queryClient.getQueryData<T>([path]) ?? (await readCache<T>(path))) as T | null;
  if (cur == null) return;
  const next = fn(cur);
  queryClient.setQueryData([path], next);
  await writeCache(path, next);
}

export async function clearOffline() {
  const idx: string[] = parse(await storage.getItem(IDX_KEY, null), []);
  for (const p of idx) await storage.removeItem(`cache:${p}`);
  await storage.removeItem(IDX_KEY);
  queue = [];
  failed = [];
  history = [];
  await storage.removeItem(H_KEY);
  await save();
}

export async function clearSyncHistory() {
  history = [];
  await storage.removeItem(H_KEY);
  notify();
}

// ---------------- Queue ----------------
export async function enqueue(item: Omit<QItem, "created_at">) {
  await load();
  // Dedupe by client-id: safe to call twice (e.g., retry handler) without
  // duplicating work. The server is id-idempotent anyway, but this avoids
  // extra round-trips and keeps the queue bounded.
  if (queue.some((q) => q.id === item.id) || failed.some((q) => q.id === item.id)) return;
  queue.push({ ...item, attempts: 0, created_at: new Date().toISOString() });
  await save();
  syncQueue();
}

function classifyError(e: any): "offline" | "transient" | "conflict" | "permanent" {
  if (e?.offline) return "offline";
  const s: number | undefined = e?.status;
  if (s === 409) return "conflict";
  if (s === 429 || (s !== undefined && s >= 500 && s < 600)) return "transient";
  // Timeouts / abort / unknown => treat as transient so a retry can succeed
  // when the backend hiccups during a huge flush. We still cap attempts.
  const msg = String(e?.message ?? "");
  if (!s && /timeout|network|abort|socket/i.test(msg)) return "transient";
  return "permanent";
}

function backoff(attempt: number) {
  const raw = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * Math.pow(2, attempt));
  const jitter = raw * 0.25;
  return Math.round(raw - jitter + Math.random() * jitter * 2);
}

function dueNow(it: QItem) {
  return !it.next_attempt_at || Date.parse(it.next_attempt_at) <= Date.now();
}

// Drop any locally-cached optimistic doc with this `id` from a GET's array —
// used on 409 so the next refetch shows the server's canonical state and the
// user never sees a stale "pending" row.
async function dropOptimistic(id: string) {
  const idx: string[] = parse(await storage.getItem(IDX_KEY, null), []);
  for (const p of idx) {
    try {
      const cur = queryClient.getQueryData<any>([p]) ?? (await readCache<any>(p));
      if (Array.isArray(cur)) {
        const next = cur.filter((row: any) => row?.id !== id);
        if (next.length !== cur.length) {
          queryClient.setQueryData([p], next);
          await writeCache(p, next);
        }
      }
    } catch {}
  }
}

// Send one item; mutate the queue arrays in-place according to the outcome.
async function sendOne(it: QItem) {
  try {
    await api(it.path, { method: "POST", body: it.body });
    // success
    queue = queue.filter((q) => q.id !== it.id);
    history = [{ id: it.id, label: it.label, path: it.path, created_at: it.created_at, synced_at: new Date().toISOString() }, ...history.filter((h) => h.id !== it.id)].slice(0, HISTORY_MAX);
    online = true;
    return "ok" as const;
  } catch (e: any) {
    const kind = classifyError(e);
    const idxQ = queue.findIndex((q) => q.id === it.id);
    if (kind === "offline") {
      online = false;
      // keep in queue, no attempt bump — we'll resume on reconnect.
      return "offline" as const;
    }
    if (kind === "conflict") {
      // Server is authoritative; drop local optimistic row + refetch, and keep the item visible
      // in the tray as a CONFLICT so the user knows it was not applied (can retry or discard).
      await dropOptimistic(it.id);
      queryClient.invalidateQueries({ queryKey: [it.path] });
      queue = queue.filter((q) => q.id !== it.id);
      failed.push({ ...it, conflict: true, error: e.message ?? "تعارض مع بيانات الخادم" });
      return "conflict" as const;
    }
    if (kind === "transient") {
      const attempts = (it.attempts ?? 0) + 1;
      if (attempts >= MAX_ATTEMPTS) {
        if (idxQ >= 0) queue.splice(idxQ, 1);
        failed.push({ ...it, attempts, error: e.message ?? "فشل بعد عدة محاولات" });
        return "failed" as const;
      }
      // reschedule with backoff
      const next = new Date(Date.now() + backoff(attempts - 1)).toISOString();
      if (idxQ >= 0) queue[idxQ] = { ...it, attempts, next_attempt_at: next, error: e.message };
      return "retry" as const;
    }
    // permanent — move to failed tray (server rejected it, e.g. return over the sold quantity).
    if (idxQ >= 0) queue.splice(idxQ, 1);
    failed.push({ ...it, error: e.message ?? "فشل" });
    // Drop the optimistic row so local balances / stock fall back to the server's truth.
    await dropOptimistic(it.id);
    return "failed" as const;
  }
}

export async function syncQueue() {
  await load();
  if (syncing || !queue.length) return;
  syncing = true;
  const startTotal = queue.length;
  progress = { done: 0, total: startTotal };
  notify();
  let anySuccess = false;
  let anyFailed = false;
  let syncedCount = 0;
  try {
    // Loop: on each iteration, pick up to PARALLEL items such that no two
    // items from the same `path` run concurrently (preserves per-endpoint
    // ordering). Items with a future `next_attempt_at` are skipped this round.
    // We keep looping until we either run out of ready items (then schedule a
    // wake-up for the earliest backoff) or hit an offline error.
    // Hard cap to defend against pathological retry loops in a single pass.
    let rounds = 0;
    const maxRounds = 200;
    while (queue.length && rounds < maxRounds) {
      rounds++;
      const inFlightPaths = new Set<string>();
      const batch: QItem[] = [];
      // Dependency order: offline-created customers must reach the server before any sale /
      // collection / return that references them, and sales before the returns that depend on them.
      // Checks the WHOLE queue (not just due items) so a dependency waiting on backoff still blocks.
      const ready = queue.filter(dueNow);
      const pool = queue.some((q) => q.path === "/customers")
        ? ready.filter((q) => q.path === "/customers")
        : queue.some((q) => q.path === "/sales")
          ? ready.filter((q) => q.path !== "/sales-returns")
          : ready;
      for (const it of pool) {
        if (batch.length >= PARALLEL) break;
        if (inFlightPaths.has(it.path)) continue; // keep per-path order
        batch.push(it);
        inFlightPaths.add(it.path);
      }
      if (!batch.length) {
        // Nothing ready right now; schedule a wake-up for the earliest backoff
        // and bail out — the global interval / NetInfo listener will retry.
        const future = queue
          .filter((q) => q.next_attempt_at)
          .map((q) => Date.parse(q.next_attempt_at!))
          .filter((t) => t > Date.now())
          .sort((a, b) => a - b)[0];
        if (future) scheduleWake(future - Date.now());
        break;
      }
      const outcomes = await Promise.all(batch.map(sendOne));
      // Persist after each round so a crash loses at most the in-flight batch.
      await saveQueueOnly();
      let hitOffline = false;
      for (let i = 0; i < outcomes.length; i++) {
        const o = outcomes[i];
        if (o === "ok" || o === "conflict") {
          progress.done++;
          anySuccess = true;
        }
        if (o === "ok") syncedCount++;
        if (o === "failed" || o === "conflict") anyFailed = true;
        if (o === "offline") hitOffline = true;
      }
      notify();
      if (hitOffline) break;
    }
    await save();
    if (syncedCount > 0) {
      lastSyncAt = new Date().toISOString();
      await storage.setItem(H_KEY, JSON.stringify(history));
    }
  } finally {
    syncing = false;
    progress = { done: 0, total: 0 };
    notify();
  }
  // Refetch server truth after successes AND rejections (rejected items' optimistic balance/stock edits).
  if (anySuccess || anyFailed) queryClient.invalidateQueries();
  // Notify UI listeners of successful completion so they can toast the user.
  if (syncedCount > 0) completeListeners.forEach((f) => f(syncedCount));
}

let wakeTimer: any = null;
function scheduleWake(ms: number) {
  if (wakeTimer) clearTimeout(wakeTimer);
  wakeTimer = setTimeout(() => {
    wakeTimer = null;
    syncQueue();
  }, Math.max(100, ms));
}

export async function discardFailed(id: string) {
  failed = failed.filter((f) => f.id !== id);
  await save();
}

// Move a failed item back into the queue for another try (user-initiated).
export async function retryFailed(id: string) {
  const it = failed.find((f) => f.id === id);
  if (!it) return;
  failed = failed.filter((f) => f.id !== id);
  queue.push({ ...it, attempts: 0, next_attempt_at: undefined, error: undefined });
  await save();
  syncQueue();
}

export function startSyncLoop() {
  load();
  const unsub = NetInfo.addEventListener((s) => {
    const next = !!s.isConnected && s.isInternetReachable !== false;
    if (next !== online) {
      online = next;
      notify();
    }
    if (next) syncQueue();
  });
  // Web: NetInfo may miss browser online/offline events — listen to them directly.
  const w: any = typeof window !== "undefined" ? window : null;
  const onWebOnline = () => {
    online = true;
    notify();
    syncQueue();
  };
  const onWebOffline = () => {
    online = false;
    notify();
  };
  w?.addEventListener?.("online", onWebOnline);
  w?.addEventListener?.("offline", onWebOffline);
  // Periodic kick so backoff-scheduled items eventually get picked up even
  // if the NetInfo listener never fires (web preview, flaky signal).
  const t = setInterval(syncQueue, 30000);
  return () => {
    unsub();
    clearInterval(t);
    w?.removeEventListener?.("online", onWebOnline);
    w?.removeEventListener?.("offline", onWebOffline);
    if (wakeTimer) clearTimeout(wakeTimer);
  };
}

export function useSyncState() {
  const [, force] = useState(0);
  useEffect(() => {
    load();
    const f = () => force((n) => n + 1);
    listeners.add(f);
    return () => {
      listeners.delete(f);
    };
  }, []);
  return { pending: queue, failed, history, lastSyncAt, online, syncing, progress };
}
