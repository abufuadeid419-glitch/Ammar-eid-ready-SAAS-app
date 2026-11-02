import { v } from "convex/values";

import { internalMutation } from "./_generated/server";

// Write-through bridge used by the FastAPI backend (backend/convex_bridge.py).
// FastAPI remains the source of truth (MongoDB); after every relevant write it
// mirrors the document into Convex through these secret-guarded mutations so the
// app can read the four ported domains (routes, vouchers, purchases,
// notifications) + the live agent map straight from Convex in real time.
const SECRET = "smartsystem-migrate-2026";

const strip = (doc: any) => {
  const { _id, _creationTime, ...rest } = doc ?? {};
  return rest;
};

// Upsert a document matched by a single business key field (e.g. "id", "user_id").
export const upsert = internalMutation({
  args: { secret: v.string(), table: v.string(), keyField: v.string(), doc: v.any() },
  handler: async (ctx, { secret, table, keyField, doc }) => {
    if (secret !== SECRET) throw new Error("bad secret");
    const rest = strip(doc);
    const keyVal = rest[keyField];
    const existing = await ctx.db
      .query(table as any)
      .filter((q: any) => q.eq(q.field(keyField), keyVal))
      .first();
    if (existing) await ctx.db.patch(existing._id, rest);
    else await ctx.db.insert(table as any, rest);
    return { ok: true, inserted: !existing };
  },
});

// Append-only insert (e.g. agent_locations GPS pings).
export const insertRow = internalMutation({
  args: { secret: v.string(), table: v.string(), doc: v.any() },
  handler: async (ctx, { secret, table, doc }) => {
    if (secret !== SECRET) throw new Error("bad secret");
    await ctx.db.insert(table as any, strip(doc));
    return { ok: true };
  },
});

// Delete a document matched by a single business key field.
export const removeByKey = internalMutation({
  args: { secret: v.string(), table: v.string(), keyField: v.string(), value: v.any() },
  handler: async (ctx, { secret, table, keyField, value }) => {
    if (secret !== SECRET) throw new Error("bad secret");
    const existing = await ctx.db
      .query(table as any)
      .filter((q: any) => q.eq(q.field(keyField), value))
      .first();
    if (existing) await ctx.db.delete(existing._id);
    return { ok: true };
  },
});
