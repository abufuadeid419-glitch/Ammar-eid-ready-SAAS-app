import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
import { cleanAll } from "./lib";

// Resolve the user from a bearer token WITHOUT throwing — the header bell may
// render a moment before auth.syncSession has mirrored the session into Convex.
async function softUser(ctx: any, token: string) {
  const sess = await ctx.db
    .query("user_sessions")
    .withIndex("by_token", (q: any) => q.eq("session_token", token))
    .unique();
  if (!sess) return null;
  return await ctx.db
    .query("users")
    .withIndex("by_user_id", (q: any) => q.eq("user_id", sess.user_id))
    .unique();
}

// GET /api/notifications — the logged-in user's notifications + unread count.
// Read live from Convex so the header bell updates in real time (useQuery).
export const list = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const user = await softUser(ctx, token);
    if (!user) return { items: [], unread: 0 };
    const rows = await ctx.db
      .query("notifications")
      .withIndex("by_user", (q) => q.eq("user_id", user.user_id))
      .collect();
    rows.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    const items = cleanAll(rows).slice(0, 100);
    return { items, unread: items.filter((i: any) => !i.read).length };
  },
});

// POST /api/notifications/read-all — mark every notification of the user read.
export const readAll = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const user = await softUser(ctx, token);
    if (!user) return { ok: true };
    const rows = await ctx.db
      .query("notifications")
      .withIndex("by_user", (q) => q.eq("user_id", user.user_id))
      .collect();
    for (const r of rows) if (!r.read) await ctx.db.patch(r._id, { read: true });
    return { ok: true };
  },
});
