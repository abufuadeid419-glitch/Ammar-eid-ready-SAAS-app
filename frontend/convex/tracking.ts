import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
import { AGENT, STAFF, nowIso, require } from "./lib";

// POST /api/locations  (AGENT) — record a GPS ping and update the agent's last location.
export const postLocation = mutation({
  args: { token: v.string(), lat: v.number(), lng: v.number(), accuracy: v.optional(v.union(v.number(), v.null())) },
  handler: async (ctx, { token, lat, lng, accuracy }) => {
    const user = await require(ctx, token, AGENT);
    const loc = { lat, lng, accuracy: accuracy ?? null, at: nowIso() };
    await ctx.db.insert("agent_locations", { org_id: user.org_id!, user_id: user.user_id, ...loc });
    const u = await ctx.db.query("users").withIndex("by_user_id", (q) => q.eq("user_id", user.user_id)).unique();
    if (u) await ctx.db.patch(u._id, { last_location: loc });
    return { ok: true };
  },
});

async function orgAgents(ctx: any, org: string) {
  const users = await ctx.db.query("users").withIndex("by_org", (q: any) => q.eq("org_id", org)).collect();
  return users.filter((u: any) => u.employee_type === "FIELD_AGENT");
}

// GET /api/tracking/agents  (STAFF) — each agent's last location + today's sale visits (live map).
export const agents = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const user = await require(ctx, token, STAFF);
    const org = user.org_id!;
    const today = nowIso().slice(0, 10);
    const out: any[] = [];
    for (const a of await orgAgents(ctx, org)) {
      const visits = (
        await ctx.db
          .query("sales")
          .withIndex("by_distributor", (q) => q.eq("distributor_id", a.user_id))
          .filter((q) => q.eq(q.field("org_id"), org))
          .collect()
      )
        .filter((s) => String(s.created_at) >= today && s.lat != null)
        .map((s) => ({ invoice_no: s.invoice_no, customer_name: s.customer_name, lat: s.lat, lng: s.lng, total: s.total }));
      out.push({ user_id: a.user_id, name: a.name ?? null, email: a.email, last_location: a.last_location ?? null, today_visits: visits });
    }
    return out;
  },
});

// GET /api/tracking/agents/{uid}/trail  (STAFF) — one agent's GPS points + visits for a day.
export const trail = query({
  args: { token: v.string(), user_id: v.string(), date: v.optional(v.string()) },
  handler: async (ctx, { token, user_id, date }) => {
    const user = await require(ctx, token, STAFF);
    const org = user.org_id!;
    const d = date || nowIso().slice(0, 10);
    const start = d;
    const end = new Date(Date.parse(d + "T00:00:00.000Z") + 86400000).toISOString().slice(0, 10);
    const target = (await orgAgents(ctx, org)).find((a: any) => a.user_id === user_id);
    if (!target) throw new Error("الموزع غير موجود");
    const inRange = (s: any) => s >= start && s < end;
    const points = (
      await ctx.db.query("agent_locations").withIndex("by_org_user", (q) => q.eq("org_id", org).eq("user_id", user_id)).collect()
    )
      .filter((p) => inRange(String(p.at)))
      .sort((a, b) => String(a.at).localeCompare(String(b.at)))
      .map((p) => ({ lat: p.lat, lng: p.lng, at: p.at, accuracy: p.accuracy ?? null }));
    const visits = (
      await ctx.db
        .query("sales")
        .withIndex("by_distributor", (q) => q.eq("distributor_id", user_id))
        .filter((q) => q.eq(q.field("org_id"), org))
        .collect()
    )
      .filter((s) => inRange(String(s.created_at)) && s.lat != null)
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
      .map((s) => ({ invoice_no: s.invoice_no, customer_name: s.customer_name, lat: s.lat, lng: s.lng, total: s.total, created_at: s.created_at }));
    return { date: d, points, visits };
  },
});
