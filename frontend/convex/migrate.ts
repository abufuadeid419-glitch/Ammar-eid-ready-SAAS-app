import { v } from "convex/values";

import { internalMutation, internalQuery } from "./_generated/server";

// Dev-only bulk import endpoints used by scripts/migrate_mongo_to_convex.mjs.
// Guarded by a shared secret. Remove (and redeploy) once the migration is done.
const SECRET = "smartsystem-migrate-2026";

export const importBatch = internalMutation({
  args: { secret: v.string(), table: v.string(), docs: v.array(v.any()) },
  handler: async (ctx, { secret, table, docs }) => {
    if (secret !== SECRET) throw new Error("bad secret");
    let n = 0;
    for (const d of docs) {
      const { _id, _creationTime, ...rest } = d ?? {};
      await ctx.db.insert(table as any, rest);
      n++;
    }
    return { inserted: n };
  },
});

export const clearTable = internalMutation({
  args: { secret: v.string(), table: v.string() },
  handler: async (ctx, { secret, table }) => {
    if (secret !== SECRET) throw new Error("bad secret");
    const rows = await ctx.db.query(table as any).collect();
    for (const r of rows) await ctx.db.delete(r._id);
    return { deleted: rows.length };
  },
});

// Row count for a table — used by the migration script to verify counts match Mongo.
export const countTable = internalQuery({
  args: { secret: v.string(), table: v.string() },
  handler: async (ctx, { secret, table }) => {
    if (secret !== SECRET) throw new Error("bad secret");
    const rows = await ctx.db.query(table as any).collect();
    return { count: rows.length };
  },
});
