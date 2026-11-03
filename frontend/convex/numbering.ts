// Document numbering — pre-reserved, gap-tolerant, conflict-free ranges for offline work.
//
// Every company has ONE counter per document kind (table `counters`). Online server-side creation
// takes the next value atomically (nextNo). For offline work, a device reserves a contiguous block
// [start..end] from the same counter in a single atomic mutation (Convex mutations are serializable,
// so two devices can never receive overlapping ranges). The device then stamps FINAL numbers locally
// from its block; the server validates each one on sync (allocDocNo in lib.ts) and records it as used.
// Unused numbers of a block remain reserved for that device (a gap is preferable to a duplicate).
import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
import { ANY_ORG, BLOCK_SIZE, DOC_KINDS, nowIso, require } from "./lib";

const blockOut = (b: any) => ({ id: String(b._id), kind: b.kind, prefix: DOC_KINDS[b.kind], start: b.start, end: b.end, used: b.used ?? [] });
const unusedOf = (b: any) => b.end - b.start + 1 - (b.used?.length ?? 0);

// POST /api/numbers/reserve { device_id, kinds: ["sale","col",...] }
// Returns every block of this user+device that still has unused numbers (allocating a new block
// for a kind only when its outstanding unused count dropped below one block size).
export const reserve = mutation({
  args: { token: v.string(), device_id: v.string(), kinds: v.array(v.string()) },
  handler: async (ctx, a) => {
    const user = await require(ctx, a.token, ANY_ORG);
    const device = a.device_id.trim().slice(0, 64);
    if (device.length < 8) throw new Error("معرّف الجهاز غير صالح");
    const org_id = user.org_id!;
    const out: any[] = [];
    for (const kind of [...new Set(a.kinds)]) {
      if (!DOC_KINDS[kind]) continue;
      const mine = (
        await ctx.db
          .query("number_blocks")
          .withIndex("by_org_user_kind", (q: any) => q.eq("org_id", org_id).eq("user_id", user.user_id).eq("kind", kind))
          .collect()
      ).filter((b: any) => b.device_id === device && unusedOf(b) > 0);
      const outstanding = mine.reduce((s: number, b: any) => s + unusedOf(b), 0);
      // Same rule as the client: top up only when less than half a block is left, so a device holds
      // at most ~1.5 blocks per kind and unused numbers (possible gaps) stay small.
      if (outstanding < BLOCK_SIZE[kind] / 2) {
        // Atomic range allocation from the company counter.
        const c = await ctx.db.query("counters").withIndex("by_org_kind", (q) => q.eq("org_id", org_id).eq("kind", kind)).unique();
        const start = (c?.n ?? 0) + 1;
        const end = start + BLOCK_SIZE[kind] - 1;
        if (c) await ctx.db.patch(c._id, { n: end });
        else await ctx.db.insert("counters", { org_id, kind, n: end });
        const _id = await ctx.db.insert("number_blocks", { org_id, user_id: user.user_id, device_id: device, kind, start, end, used: [], created_at: nowIso() });
        mine.push(await ctx.db.get(_id));
      }
      out.push(...mine.map(blockOut));
    }
    return out;
  },
});

// GET /api/numbers/blocks — owner/accountant audit view of reserved ranges (who holds which numbers).
export const blocks = query({
  args: { token: v.string() },
  handler: async (ctx, a) => {
    const user = await require(ctx, a.token, ["OWNER", "ACCOUNTANT"]);
    const all = await ctx.db.query("number_blocks").withIndex("by_org_user_kind", (q: any) => q.eq("org_id", user.org_id)).collect();
    return all.map((b: any) => ({ ...blockOut(b), user_id: b.user_id, device_id: b.device_id, unused: unusedOf(b), created_at: b.created_at }));
  },
});
