import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
import { AGENT, ANY_ORG, OWNER, STAFF, docOrgUnique, newId, nowIso, require } from "./lib";

// Haversine distance in km (mirror server.py _dist).
function dist(a: [number, number], b: [number, number]) {
  const rad = (d: number) => (d * Math.PI) / 180;
  const [lat1, lng1, lat2, lng2] = [a[0], a[1], b[0], b[1]].map(rad);
  const h =
    Math.sin((lat2 - lat1) / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin((lng2 - lng1) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

// Build route stops from the distributor's OWN customers (mirror _build_stops).
async function buildStops(ctx: any, org_id: string, customer_ids: string[], old: any[], distributor_id: string) {
  const prev: Record<string, any> = {};
  for (const s of old) prev[s.customer_id] = s;
  const stops: any[] = [];
  for (const cid of Array.from(new Set(customer_ids))) {
    const c = await docOrgUnique(ctx, "customers", cid, org_id);
    if (!c || c.distributor_id !== distributor_id) continue;
    const p = prev[cid] || {};
    stops.push({
      customer_id: c.id,
      customer_name: c.name,
      address: c.address ?? "",
      phone: c.phone ?? "",
      lat: c.lat ?? null,
      lng: c.lng ?? null,
      status: p.status ?? "PENDING",
      note: p.note ?? "",
      at: p.at ?? null,
    });
  }
  return stops;
}

async function routeAccess(ctx: any, rid: string, user: any) {
  const r = await docOrgUnique(ctx, "routes", rid, user.org_id);
  if (!r) throw new Error("خط السير غير موجود");
  if (user.employee_type === "FIELD_AGENT" && r.distributor_id !== user.user_id) throw new Error("ليس لديك صلاحية");
  return r;
}

const cleanRoute = (r: any) => {
  if (!r) return r;
  const { _id, _creationTime, ...rest } = r;
  return rest;
};

// GET /api/routes (STAFF) — all route plans, newest first; optional date / distributor filter.
export const list = query({
  args: { token: v.string(), date: v.optional(v.string()), distributor_id: v.optional(v.string()) },
  handler: async (ctx, { token, date, distributor_id }) => {
    const user = await require(ctx, token, STAFF);
    let rows = await ctx.db.query("routes").withIndex("by_org", (q) => q.eq("org_id", user.org_id!)).collect();
    if (date) rows = rows.filter((r) => r.date === date);
    if (distributor_id) rows = rows.filter((r) => r.distributor_id === distributor_id);
    rows.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    return rows.map(cleanRoute);
  },
});

// GET /api/routes/mine (AGENT) — the distributor's route for a day (default today).
export const mine = query({
  args: { token: v.string(), date: v.optional(v.string()) },
  handler: async (ctx, { token, date }) => {
    const user = await require(ctx, token, AGENT);
    const d = date || nowIso().slice(0, 10);
    const r = await ctx.db
      .query("routes")
      .withIndex("by_dist_date", (q) => q.eq("distributor_id", user.user_id).eq("date", d))
      .first();
    return cleanRoute(r);
  },
});

// POST /api/routes (OWNER) — create/replace a distributor's plan for a date.
export const save = mutation({
  args: { token: v.string(), distributor_id: v.string(), date: v.string(), customer_ids: v.array(v.string()) },
  handler: async (ctx, { token, distributor_id, date, customer_ids }) => {
    const user = await require(ctx, token, OWNER);
    const dist = await ctx.db
      .query("users")
      .withIndex("by_user_id", (q) => q.eq("user_id", distributor_id))
      .unique();
    if (!dist || dist.org_id !== user.org_id || dist.employee_type !== "FIELD_AGENT") throw new Error("الموزع غير موجود");
    const ex = await ctx.db
      .query("routes")
      .withIndex("by_dist_date", (q) => q.eq("distributor_id", distributor_id).eq("date", date))
      .first();
    const stops = await buildStops(ctx, user.org_id!, customer_ids, ex?.stops ?? [], distributor_id);
    if (ex) {
      await ctx.db.patch(ex._id, { stops });
      return cleanRoute(await ctx.db.get(ex._id));
    }
    const doc = {
      id: newId(),
      org_id: user.org_id!,
      distributor_id,
      distributor_name: dist.name ?? null,
      date,
      stops,
      created_at: nowIso(),
    };
    await ctx.db.insert("routes", doc);
    return doc;
  },
});

// DELETE /api/routes/{rid} (OWNER)
export const remove = mutation({
  args: { token: v.string(), id: v.string() },
  handler: async (ctx, { token, id }) => {
    const user = await require(ctx, token, OWNER);
    const r = await docOrgUnique(ctx, "routes", id, user.org_id!);
    if (r) await ctx.db.delete(r._id);
    return { ok: true };
  },
});

// POST /api/routes/{rid}/optimize (ANY_ORG) — nearest-neighbour ordering of pending stops.
export const optimize = mutation({
  args: { token: v.string(), id: v.string(), lat: v.optional(v.union(v.number(), v.null())), lng: v.optional(v.union(v.number(), v.null())) },
  handler: async (ctx, { token, id, lat, lng }) => {
    const user = await require(ctx, token, ANY_ORG);
    if (user.role === "EMPLOYEE" && user.employee_type !== "FIELD_AGENT") throw new Error("ليس لديك صلاحية");
    const r = await routeAccess(ctx, id, user);
    const stops = await buildStops(ctx, user.org_id!, (r.stops ?? []).map((s: any) => s.customer_id), r.stops ?? [], r.distributor_id!);
    const done = stops.filter((s) => s.status !== "PENDING");
    const located = stops.filter((s) => s.status === "PENDING" && s.lat != null);
    const unlocated = stops.filter((s) => s.status === "PENDING" && s.lat == null);
    let cur: [number, number] | null = null;
    if (lat != null && lng != null) cur = [lat, lng];
    else {
      const d = await ctx.db.query("users").withIndex("by_user_id", (q) => q.eq("user_id", r.distributor_id!)).unique();
      const loc = (d as any)?.last_location;
      cur = loc ? [loc.lat, loc.lng] : located.length ? [located[0].lat, located[0].lng] : null;
    }
    const ordered: any[] = [];
    const pool = [...located];
    while (pool.length && cur) {
      let bi = 0;
      for (let i = 1; i < pool.length; i++) {
        if (dist(cur, [pool[i].lat, pool[i].lng]) < dist(cur, [pool[bi].lat, pool[bi].lng])) bi = i;
      }
      const nxt = pool.splice(bi, 1)[0];
      ordered.push(nxt);
      cur = [nxt.lat, nxt.lng];
    }
    const next = [...done, ...ordered, ...pool, ...unlocated];
    await ctx.db.patch(r._id, { stops: next });
    return { ...cleanRoute(await ctx.db.get(r._id)), unlocated: unlocated.length };
  },
});

// POST /api/routes/{rid}/stops/{cid}/status (AGENT)
export const stopStatus = mutation({
  args: { token: v.string(), id: v.string(), customer_id: v.string(), status: v.string(), note: v.optional(v.string()) },
  handler: async (ctx, { token, id, customer_id, status, note }) => {
    const user = await require(ctx, token, AGENT);
    if (!["VISITED", "SKIPPED", "PENDING"].includes(status)) throw new Error("حالة غير صالحة");
    const r = await routeAccess(ctx, id, user);
    const stops = (r.stops ?? []).map((s: any) =>
      s.customer_id === customer_id ? { ...s, status, note: note ?? "", at: nowIso() } : s,
    );
    await ctx.db.patch(r._id, { stops });
    return cleanRoute(await ctx.db.get(r._id));
  },
});

// GET /api/routes/kpis (STAFF) — per-agent visit/conversion rates for the last N days.
export const kpis = query({
  args: { token: v.string(), days: v.optional(v.number()) },
  handler: async (ctx, { token, days }) => {
    const user = await require(ctx, token, STAFF);
    const since = new Date(Date.now() - (days ?? 7) * 86400000).toISOString().slice(0, 10);
    const routes = (await ctx.db.query("routes").withIndex("by_org", (q) => q.eq("org_id", user.org_id!)).collect())
      .filter((r) => String(r.date) >= since)
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const agg: Record<string, any> = {};
    for (const r of routes) {
      const a =
        agg[r.distributor_id!] ||
        (agg[r.distributor_id!] = {
          distributor_id: r.distributor_id,
          name: r.distributor_name ?? null,
          routes: 0,
          stops: 0,
          visited: 0,
          skipped: 0,
          pending: 0,
          sold: 0,
        });
      a.routes += 1;
      const dayStart = r.date!;
      const dayEnd = r.date! + "T23:59:59.999";
      const sold = new Set(
        (await ctx.db.query("sales").withIndex("by_distributor", (q) => q.eq("distributor_id", r.distributor_id!)).collect())
          .filter((s) => String(s.created_at) >= dayStart && String(s.created_at) < dayEnd)
          .map((s) => s.customer_id),
      );
      for (const st of r.stops ?? []) {
        a.stops += 1;
        a[st.status === "VISITED" ? "visited" : st.status === "SKIPPED" ? "skipped" : "pending"] += 1;
        if (sold.has(st.customer_id)) a.sold += 1;
      }
    }
    const out = Object.values(agg).map((a: any) => ({
      ...a,
      visit_rate: a.stops ? Math.round((a.visited / a.stops) * 100) : 0,
      conversion_rate: a.stops ? Math.round((a.sold / a.stops) * 100) : 0,
    }));
    out.sort((x: any, y: any) => y.visit_rate - x.visit_rate);
    return { agents: out, history: routes.slice(0, 30).map(cleanRoute) };
  },
});
