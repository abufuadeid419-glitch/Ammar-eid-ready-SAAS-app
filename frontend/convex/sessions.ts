import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
import { getUser, newId, nowIso } from "./lib";

const SESSION_MS = 30 * 86400000;

// POST /api/auth/touch — "trusted device": slide the 30-day session forward on every app open and
// stamp the device label, so staff who use the app at least monthly never have to re-verify by code.
export const touch = mutation({
  args: { token: v.string(), device: v.optional(v.string()), platform: v.optional(v.string()) },
  handler: async (ctx, { token, device, platform }) => {
    const sess = await ctx.db.query("user_sessions").withIndex("by_token", (q) => q.eq("session_token", token)).unique();
    if (!sess) throw new Error("الجلسة غير صالحة");
    await ctx.db.patch(sess._id, {
      device_id: sess.device_id ?? newId(),
      device: device?.slice(0, 60) ?? sess.device,
      platform: platform?.slice(0, 20) ?? sess.platform,
      last_seen_at: nowIso(),
      expires_at: new Date(Date.now() + SESSION_MS).toISOString(),
    });
    return { ok: true };
  },
});

// GET /api/auth/sessions — list this user's trusted devices (never exposes the raw tokens).
export const list = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const user = await getUser(ctx, token);
    const current = await ctx.db.query("user_sessions").withIndex("by_token", (q) => q.eq("session_token", token)).unique();
    const rows = await ctx.db.query("user_sessions").withIndex("by_user", (q) => q.eq("user_id", user.user_id)).collect();
    return rows
      .map((s) => ({
        device_id: s.device_id ?? s._id,
        device: s.device ?? "جهاز غير معروف",
        platform: s.platform ?? null,
        last_seen_at: s.last_seen_at ?? s.created_at ?? null,
        created_at: s.created_at ?? null,
        current: s._id === current?._id,
      }))
      .sort((a, b) => (a.current ? -1 : b.current ? 1 : String(b.last_seen_at).localeCompare(String(a.last_seen_at))));
  },
});

// DELETE /api/auth/sessions/:id — sign a trusted device out (revoke its session).
export const revoke = mutation({
  args: { token: v.string(), device_id: v.string() },
  handler: async (ctx, { token, device_id }) => {
    const user = await getUser(ctx, token);
    const rows = await ctx.db.query("user_sessions").withIndex("by_user", (q) => q.eq("user_id", user.user_id)).collect();
    const target = rows.find((s) => (s.device_id ?? s._id) === device_id);
    if (target) await ctx.db.delete(target._id);
    return { ok: true };
  },
});
