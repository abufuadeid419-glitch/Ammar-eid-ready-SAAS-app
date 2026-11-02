import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
import { AGENT, ANY_ORG, clean, cleanAll, isAgent, newId, nowIso, orgById, orgLimits, require } from "./lib";

function validateCustomer(a: any) {
  const missing: string[] = [];
  if (!(a.name || "").trim()) missing.push("اسم العميل");
  if (!(a.phone || "").trim()) missing.push("الهاتف");
  if (!(a.address || "").trim()) missing.push("العنوان");
  if (a.lat === undefined || a.lat === null || a.lng === undefined || a.lng === null) missing.push("موقع العميل (GPS)");
  if (missing.length) throw new Error("جميع بيانات العميل إلزامية. الحقول الناقصة: " + missing.join("، "));
  const digits = (a.phone || "").replace(/\D/g, "");
  if (digits.length < 7) throw new Error("رقم الهاتف غير صالح");
}

async function orgCustomer(ctx: any, user: any, cid: string) {
  const c = await ctx.db
    .query("customers")
    .withIndex("by_biz_id", (q: any) => q.eq("id", cid))
    .filter((q: any) => q.eq(q.field("org_id"), user.org_id))
    .unique();
  if (!c || (isAgent(user) && c.distributor_id !== user.user_id)) throw new Error("العميل غير موجود");
  return c;
}

// GET /api/customers  (ANY_ORG; agents see only their own)
export const list = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const user = await require(ctx, token, ANY_ORG);
    let custs;
    if (isAgent(user)) {
      custs = await ctx.db
        .query("customers")
        .withIndex("by_distributor", (q) => q.eq("distributor_id", user.user_id))
        .filter((q) => q.eq(q.field("org_id"), user.org_id!))
        .collect();
    } else {
      custs = await ctx.db
        .query("customers")
        .withIndex("by_org", (q) => q.eq("org_id", user.org_id!))
        .collect();
      const users = await ctx.db.query("users").withIndex("by_org", (q) => q.eq("org_id", user.org_id!)).collect();
      const names: Record<string, string> = {};
      for (const u of users) names[u.user_id] = (u.name as string) || u.email;
      for (const c of custs as any[]) c.distributor_name = names[c.distributor_id as string] ?? c.distributor_name ?? "";
    }
    custs.sort((a: any, b: any) => (a.name || "").localeCompare(b.name || ""));
    return cleanAll(custs);
  },
});

// POST /api/customers  (AGENT only)
export const create = mutation({
  args: {
    token: v.string(),
    id: v.optional(v.string()),
    name: v.string(),
    phone: v.optional(v.string()),
    address: v.optional(v.string()),
    location: v.optional(v.string()),
    type_id: v.optional(v.union(v.string(), v.null())),
    lat: v.optional(v.union(v.number(), v.null())),
    lng: v.optional(v.union(v.number(), v.null())),
  },
  handler: async (ctx, a) => {
    const user = await require(ctx, a.token, AGENT);
    if (a.id) {
      const ex = await ctx.db
        .query("customers")
        .withIndex("by_biz_id", (q) => q.eq("id", a.id!))
        .filter((q) => q.eq(q.field("org_id"), user.org_id!))
        .unique();
      if (ex) return clean(ex);
    }
    validateCustomer(a);
    // Plan limit on customers (server-side; Convex mutations are serialized so concurrent creates can't overshoot).
    const lim = await orgLimits(ctx, await orgById(ctx, user.org_id!));
    if (lim.customers != null) {
      const count = (await ctx.db.query("customers").withIndex("by_org", (q) => q.eq("org_id", user.org_id!)).collect()).length;
      if (count >= lim.customers) throw new Error(`خطتك تسمح بـ ${lim.customers} عميل فقط — قم بالترقية لإضافة المزيد`);
    }
    if (a.type_id) {
      const t = await ctx.db.query("customer_types").withIndex("by_biz_id", (q) => q.eq("id", a.type_id as string)).filter((q) => q.eq(q.field("org_id"), user.org_id!)).unique();
      if (!t) throw new Error("فئة العميل غير موجودة");
    }
    const doc = {
      id: a.id || newId(),
      org_id: user.org_id!,
      name: a.name,
      phone: a.phone ?? "",
      address: a.address ?? "",
      location: a.location ?? "",
      type_id: a.type_id ?? null,
      lat: a.lat ?? null,
      lng: a.lng ?? null,
      balance: 0,
      distributor_id: user.user_id,
      distributor_name: user.name ?? null,
      created_by: user.user_id,
      created_at: nowIso(),
    };
    await ctx.db.insert("customers", doc);
    return doc;
  },
});

// PUT /api/customers/{cid}  (AGENT only, own customer)
export const update = mutation({
  args: {
    token: v.string(),
    id: v.string(),
    name: v.string(),
    phone: v.optional(v.string()),
    address: v.optional(v.string()),
    location: v.optional(v.string()),
    type_id: v.optional(v.union(v.string(), v.null())),
    lat: v.optional(v.union(v.number(), v.null())),
    lng: v.optional(v.union(v.number(), v.null())),
  },
  handler: async (ctx, a) => {
    const user = await require(ctx, a.token, AGENT);
    const existing = await orgCustomer(ctx, user, a.id);
    validateCustomer(a);
    await ctx.db.patch(existing._id, {
      name: a.name,
      phone: a.phone ?? "",
      address: a.address ?? "",
      location: a.location ?? "",
      type_id: a.type_id ?? null,
      lat: a.lat ?? null,
      lng: a.lng ?? null,
    });
    return clean(await ctx.db.get(existing._id));
  },
});

// POST /api/customers/{cid}/reminded  (ANY_ORG)
export const reminded = mutation({
  args: { token: v.string(), id: v.string() },
  handler: async (ctx, a) => {
    const user = await require(ctx, a.token, ANY_ORG);
    const c = await orgCustomer(ctx, user, a.id);
    await ctx.db.patch(c._id, { last_reminder_at: nowIso(), last_reminder_by: user.name ?? null });
    return { ok: true };
  },
});

// GET /api/customers/{cid}/statement  (ANY_ORG)
export const statement = query({
  args: { token: v.string(), id: v.string() },
  handler: async (ctx, a) => {
    const user = await require(ctx, a.token, ANY_ORG);
    const cust = await orgCustomer(ctx, user, a.id);
    const rows: any[] = [];
    const byCustomer = (table: any) =>
      ctx.db.query(table).withIndex("by_customer", (q: any) => q.eq("customer_id", a.id)).filter((q: any) => q.eq(q.field("org_id"), user.org_id!)).collect();
    for (const s of await byCustomer("sales")) rows.push({ type: "SALE", ref: s.invoice_no, debit: s.total, credit: s.paid_amount, date: s.created_at });
    for (const c of await byCustomer("collections")) rows.push({ type: "COLLECTION", ref: c.receipt_no, debit: 0, credit: c.amount, date: c.created_at });
    for (const r of await byCustomer("sales_returns")) rows.push({ type: "RETURN", ref: r.return_no, debit: 0, credit: r.total, date: r.created_at });
    for (const p of await byCustomer("payment_vouchers")) rows.push({ type: "PAYMENT", ref: p.voucher_no, debit: p.amount, credit: 0, date: p.created_at });
    rows.sort((x, y) => String(x.date).localeCompare(String(y.date)));
    return { customer: clean(cust), rows };
  },
});
