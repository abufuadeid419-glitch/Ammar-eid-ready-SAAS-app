import { v } from "convex/values";

import { internalMutation, mutation, query } from "./_generated/server";
import {
  genCode,
  linePieces,
  ANY_ORG,
  DEV,
  OWNER,
  STAFF,
  clean,
  cleanAll,
  docOrgUnique,
  getUser,
  newId,
  notify,
  nowIso,
  orgById,
  orgOwnerIds,
  require,
  round2,
  sumBy,
  isPro,
  audit,
  hasFeature,
  MODULES,
  TIERS,
  cleanModules,
} from "./lib";

const PROFILE_FIELDS = ["name", "phone", "email", "address", "tax_no", "cr_no", "invoice_footer", "phone_country_code"];

async function enrich(ctx: any, user: any) {
  const pw = await ctx.db.query("user_passwords").withIndex("by_user", (q: any) => q.eq("user_id", user.user_id)).unique();
  const out: any = { ...clean(user), has_password: !!pw, org: null };
  if (user.org_id) out.org = clean(await orgById(ctx, user.org_id));
  return out;
}

// ---------------- auth: me / logout / consent / delete account ----------------
export const me = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => enrich(ctx, await getUser(ctx, token)),
});

export const logout = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const s = await ctx.db.query("user_sessions").withIndex("by_token", (q) => q.eq("session_token", token)).unique();
    if (s) await ctx.db.delete(s._id);
    return { ok: true };
  },
});

export const consent = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const user = await getUser(ctx, token);
    await ctx.db.patch(user._id, { consent_at: nowIso() });
    return enrich(ctx, await ctx.db.get(user._id));
  },
});

// Account deletion (RBAC): owners and employees may delete their own account; developers may not.
// An owner deleting their account deletes the whole organization and its data.
export const deleteAccount = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const user = await getUser(ctx, token);
    if (user.role === "DEVELOPER") throw new Error("حساب المطور لا يملك صلاحية حذف الحسابات");
    if (user.role === "OWNER" && user.org_id) await wipeOrg(ctx, user.org_id);
    for (const s of await ctx.db.query("user_sessions").withIndex("by_user", (q) => q.eq("user_id", user.user_id)).collect()) await ctx.db.delete(s._id);
    for (const n of await ctx.db.query("notifications").withIndex("by_user", (q) => q.eq("user_id", user.user_id)).collect()) await ctx.db.delete(n._id);
    for (const p of await ctx.db.query("user_passwords").withIndex("by_user", (q) => q.eq("user_id", user.user_id)).collect()) await ctx.db.delete(p._id);
    await ctx.db.delete(user._id);
    return { ok: true };
  },
});

// PUT /api/org/pricing-method (OWNER) — how sale prices follow purchase-cost changes: FIFO | WAVG | LATEST.
export const orgPricingMethod = mutation({
  args: { token: v.string(), method: v.string() },
  handler: async (ctx, a) => {
    const user = await require(ctx, a.token, OWNER);
    if (!["FIFO", "WAVG", "LATEST"].includes(a.method)) throw new Error("طريقة التسعير غير صالحة");
    const org: any = await orgById(ctx, user.org_id!);
    await ctx.db.patch(org._id, { pricing_method: a.method });
    return { pricing_method: a.method };
  },
});

// ---------------- sales: void ----------------
export const voidSale = mutation({
  args: { token: v.string(), id: v.string(), reason: v.optional(v.string()) },
  handler: async (ctx, { token, id, reason }) => {
    const user = await require(ctx, token, STAFF);
    const s = await docOrgUnique(ctx, "sales", id, user.org_id!);
    if (!s || s.voided) throw new Error("الفاتورة غير موجودة أو ملغاة");
    // Returns are only valid against sold quantity: if voiding would leave returns without a sale
    // behind them (stock + balance credited twice), refuse — remove/adjust the returns first.
    const net: Record<string, number> = {};
    for (const o of await ctx.db.query("sales").withIndex("by_customer", (q) => q.eq("customer_id", s.customer_id)).collect()) {
      if (o.org_id !== user.org_id || o.distributor_id !== s.distributor_id || (o as any).voided || o.id === s.id) continue;
      for (const it of (o.items ?? []) as any[]) net[it.product_id] = (net[it.product_id] ?? 0) + linePieces(it);
    }
    for (const r of await ctx.db.query("sales_returns").withIndex("by_customer", (q) => q.eq("customer_id", s.customer_id)).collect()) {
      if (r.org_id !== user.org_id || r.distributor_id !== s.distributor_id) continue;
      for (const it of (r.items ?? []) as any[]) net[it.product_id] = (net[it.product_id] ?? 0) - (it.pieces ?? linePieces(it));
    }
    if ((s.items ?? []).some((it: any) => (net[it.product_id] ?? 0) < -1e-9)) {
      throw new Error("لا يمكن إلغاء الفاتورة: توجد مرتجعات مسجلة على منتجاتها لهذا العميل");
    }
    for (const it of s.items || []) {
      const inv = await ctx.db.query("distributor_inventory").withIndex("by_dist_product", (q) => q.eq("distributor_id", s.distributor_id).eq("product_id", it.product_id)).unique();
      if (inv) await ctx.db.patch(inv._id, { quantity: round2((inv.quantity ?? 0) + linePieces(it)) });
      await ctx.db.insert("stock_movements", { org_id: user.org_id!, product_id: it.product_id, product_name: it.product_name, type: "SALE_VOID", qty: linePieces(it), by: user.name ?? null, by_role: user.role === "EMPLOYEE" ? "AGENT" : user.role, at: nowIso() });
    }
    const cust = await docOrgUnique(ctx, "customers", s.customer_id, user.org_id!);
    if (cust) await ctx.db.patch(cust._id, { balance: round2((cust.balance ?? 0) - (s.remaining ?? 0)) });
    await ctx.db.patch(s._id, { voided: true, void_reason: reason ?? "", voided_by: user.name ?? null, voided_at: nowIso(), orig_total: s.total, total: 0, paid_amount: 0, remaining: 0 });
    return clean(await ctx.db.get(s._id));
  },
});

// ---------------- inventory logs ----------------
export const stockMovements = query({
  args: { token: v.string(), product_id: v.optional(v.string()) },
  handler: async (ctx, { token, product_id }) => {
    const user = await require(ctx, token, STAFF);
    let rows = await ctx.db.query("stock_movements").withIndex("by_org", (q) => q.eq("org_id", user.org_id!)).collect();
    if (product_id) rows = rows.filter((r) => r.product_id === product_id);
    rows.sort((a, b) => String(b.at).localeCompare(String(a.at)));
    return cleanAll(rows.slice(0, 500));
  },
});

export const priceHistory = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const user = await require(ctx, token, STAFF);
    const rows = await ctx.db.query("price_history").withIndex("by_org", (q) => q.eq("org_id", user.org_id!)).collect();
    rows.sort((a, b) => String(b.at).localeCompare(String(a.at)));
    return cleanAll(rows.slice(0, 300));
  },
});

// ---------------- customer types / price lists ----------------
function cleanPrices(prices: any): any {
  const out: any = {};
  for (const k of Object.keys(prices || {})) {
    const v2 = prices[k];
    if (v2 !== null && v2 !== undefined && v2 !== "") {
      const n = Number(v2);
      if (Number.isNaN(n)) throw new Error("سعر غير صالح");
      out[k] = round2(n);
    }
  }
  return out;
}

export const customerTypesList = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const user = await require(ctx, token, ANY_ORG);
    const rows = await ctx.db.query("customer_types").withIndex("by_org", (q) => q.eq("org_id", user.org_id!)).collect();
    rows.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    return cleanAll(rows);
  },
});

export const customerTypesCreate = mutation({
  args: { token: v.string(), name: v.string(), prices: v.optional(v.any()) },
  handler: async (ctx, { token, name, prices }) => {
    const user = await require(ctx, token, OWNER);
    if (!name.trim()) throw new Error("اسم الفئة مطلوب");
    const doc = { id: newId(), org_id: user.org_id!, name: name.trim(), prices: cleanPrices(prices), created_at: nowIso() };
    await ctx.db.insert("customer_types", doc);
    return doc;
  },
});

export const customerTypesUpdate = mutation({
  args: { token: v.string(), id: v.string(), name: v.string(), prices: v.optional(v.any()) },
  handler: async (ctx, { token, id, name, prices }) => {
    const user = await require(ctx, token, OWNER);
    const t = await docOrgUnique(ctx, "customer_types", id, user.org_id!);
    if (t) await ctx.db.patch(t._id, { name: name.trim(), prices: cleanPrices(prices) });
    return t ? clean(await ctx.db.get(t._id)) : null;
  },
});

export const customerTypesRemove = mutation({
  args: { token: v.string(), id: v.string() },
  handler: async (ctx, { token, id }) => {
    const user = await require(ctx, token, OWNER);
    const t = await docOrgUnique(ctx, "customer_types", id, user.org_id!);
    if (t) await ctx.db.delete(t._id);
    const custs = await ctx.db.query("customers").withIndex("by_org", (q) => q.eq("org_id", user.org_id!)).collect();
    for (const c of custs) if (c.type_id === id) await ctx.db.patch(c._id, { type_id: null });
    return { ok: true };
  },
});

// ---------------- debts ----------------
const STALE_DAYS = 7;
async function staleDebtors(ctx: any, org_id: string) {
  const cutoff = new Date(Date.now() - STALE_DAYS * 86400000).toISOString();
  const rows = (await ctx.db.query("customers").withIndex("by_org", (q: any) => q.eq("org_id", org_id)).collect())
    .filter((c: any) => (c.balance || 0) > 0 && (!c.last_reminder_at || String(c.last_reminder_at) < cutoff));
  rows.sort((a: any, b: any) => (b.balance || 0) - (a.balance || 0));
  return rows;
}

export const debtsStale = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const user = await require(ctx, token, STAFF);
    return cleanAll(await staleDebtors(ctx, user.org_id!));
  },
});

// Builds the stale-debt digest for one org and notifies its owner + accountants.
async function runDigest(ctx: any, org_id: string) {
  const org: any = await orgById(ctx, org_id);
  if (!org) return { count: 0 };
  const stale = await staleDebtors(ctx, org_id);
  await ctx.db.patch(org._id, { last_debt_digest_at: nowIso() });
  if (!stale.length) return { count: 0 };
  const accts = (await ctx.db.query("users").withIndex("by_org", (q: any) => q.eq("org_id", org_id)).collect()).filter((u: any) => u.employee_type === "ACCOUNTANT");
  const names = stale.slice(0, 5).map((c: any) => c.name).join("، ") + (stale.length > 5 ? ` و${stale.length - 5} آخرين` : "");
  const total = round2(stale.reduce((n: number, c: any) => n + c.balance, 0));
  await notify(ctx, [...accts.map((a: any) => a.user_id), ...(await orgOwnerIds(ctx, org_id))], "debt_digest", "تذكير أسبوعي بالديون", `${stale.length} عميل مدين لم يتم التواصل معهم منذ ${STALE_DAYS} أيام (إجمالي ${total}): ${names}`);
  return { count: stale.length };
}

export const debtsDigest = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const user = await require(ctx, token, STAFF);
    return await runDigest(ctx, user.org_id!);
  },
});

// Weekly cron (see crons.ts): digest for every active, non-expired organization.
export const weeklyDebtDigestAll = internalMutation({
  args: {},
  handler: async (ctx) => {
    const orgs = (await ctx.db.query("organizations").collect()).filter((o: any) => o.status === "ACTIVE" && (!o.expires_at || Date.parse(o.expires_at) > Date.now()));
    let notified = 0;
    for (const o of orgs) if ((await runDigest(ctx, o.id)).count) notified++;
    return { orgs: orgs.length, notified };
  },
});

// ---------------- org profile / currency / plans / settings ----------------
export const orgProfile = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const user = await require(ctx, token, ANY_ORG);
    const org: any = await orgById(ctx, user.org_id!);
    const out: any = {};
    for (const k of PROFILE_FIELDS) out[k] = org?.[k] ?? "";
    out.has_logo = !!(org?.logo_storage || org?.logo_path);
    out.currency = org?.currency ?? "";
    out.alt_currency = org?.alt_currency ?? "";
    out.exchange_rate = org?.exchange_rate ?? 0;
    return out;
  },
});

export const orgProfileUpdate = mutation({
  args: { token: v.string(), name: v.string(), phone: v.optional(v.string()), email: v.optional(v.string()), address: v.optional(v.string()), tax_no: v.optional(v.string()), cr_no: v.optional(v.string()), invoice_footer: v.optional(v.string()), phone_country_code: v.optional(v.string()),
    // Read-only fields returned by GET /org/profile — accepted and ignored so saving the whole form never fails.
    has_logo: v.optional(v.any()), currency: v.optional(v.any()), alt_currency: v.optional(v.any()), exchange_rate: v.optional(v.any()), pricing_method: v.optional(v.any()) },
  handler: async (ctx, a) => {
    const user = await require(ctx, a.token, OWNER);
    if (!a.name.trim()) throw new Error("اسم المؤسسة مطلوب");
    const org: any = await orgById(ctx, user.org_id!);
    await ctx.db.patch(org._id, {
      name: a.name, phone: a.phone ?? "", email: a.email ?? "", address: a.address ?? "", tax_no: a.tax_no ?? "", cr_no: a.cr_no ?? "", invoice_footer: a.invoice_footer ?? "",
      phone_country_code: (a.phone_country_code ?? "").replace(/\D/g, "").slice(0, 4),
    });
    const out: any = {};
    const fresh: any = await ctx.db.get(org._id);
    for (const k of PROFILE_FIELDS) out[k] = fresh?.[k] ?? "";
    out.has_logo = !!(fresh?.logo_storage || fresh?.logo_path);
    out.currency = fresh?.currency ?? ""; out.alt_currency = fresh?.alt_currency ?? ""; out.exchange_rate = fresh?.exchange_rate ?? 0;
    return out;
  },
});

export const orgCurrency = mutation({
  args: { token: v.string(), currency: v.optional(v.string()), alt_currency: v.optional(v.string()), exchange_rate: v.optional(v.number()) },
  handler: async (ctx, a) => {
    const user = await require(ctx, a.token, OWNER);
    const org: any = await orgById(ctx, user.org_id!);
    const body = { currency: a.currency ?? "ل.س", alt_currency: a.alt_currency ?? "", exchange_rate: a.exchange_rate ?? 0 };
    await ctx.db.patch(org._id, body);
    return body;
  },
});


export const settingsPayment = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    await getUser(ctx, token);
    const s: any = await ctx.db.query("app_settings").withIndex("by_key", (q) => q.eq("key", "payment")).unique();
    return { payment_address: s?.payment_address ?? "", whatsapp: s?.whatsapp ?? "", instructions: s?.instructions ?? "" };
  },
});

// ---------------- upgrade requests ----------------


// ---------------- deletion requests (org) ----------------
export const deletionRequest = mutation({
  args: { token: v.string(), reason: v.optional(v.string()) },
  handler: async (ctx, { token, reason }) => {
    const user = await getUser(ctx, token);
    if (user.role !== "OWNER") throw new Error("ليس لديك صلاحية");
    const pending = (await ctx.db.query("deletion_requests").withIndex("by_org", (q) => q.eq("org_id", user.org_id!)).collect()).find((r) => r.status === "PENDING");
    if (pending) throw new Error("يوجد طلب حذف قيد المراجعة");
    const org: any = await orgById(ctx, user.org_id!);
    const doc = { id: newId(), org_id: org.id, org_name: org.name, owner_email: user.email, reason: reason ?? "", status: "PENDING", created_at: nowIso() };
    await ctx.db.insert("deletion_requests", doc);
    return doc;
  },
});

export const deletionList = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const user = await getUser(ctx, token);
    let rows;
    if (user.role === "DEVELOPER") rows = await ctx.db.query("deletion_requests").collect();
    else if (user.role === "OWNER") rows = await ctx.db.query("deletion_requests").withIndex("by_org", (q) => q.eq("org_id", user.org_id!)).collect();
    else throw new Error("ليس لديك صلاحية");
    rows.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    return cleanAll(rows);
  },
});

export const deletionCancel = mutation({
  args: { token: v.string(), id: v.string() },
  handler: async (ctx, { token, id }) => {
    const user = await getUser(ctx, token);
    if (user.role !== "OWNER") throw new Error("ليس لديك صلاحية");
    const r = await docOrgUnique(ctx, "deletion_requests", id, user.org_id!);
    if (r && r.status === "PENDING") await ctx.db.delete(r._id);
    return { ok: true };
  },
});

// ---------------- app version (public) ----------------
export const appVersionLatest = query({
  args: { platform: v.optional(v.string()) },
  handler: async (ctx, { platform }) => {
    const p = platform || "all";
    const rows = (await ctx.db.query("app_versions").collect()).filter((v2) => v2.platform === p || v2.platform === "all");
    rows.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    return rows.length ? clean(rows[0]) : null;
  },
});

// ---------------- backup export ----------------
export const backupExport = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const user = await require(ctx, token, OWNER);
    const org = user.org_id!;
    const data: any = { exported_at: nowIso(), organization: clean(await orgById(ctx, org)) };
    const tables = ["products", "customers", "customer_types", "sales", "collections", "sales_returns", "purchases", "purchase_returns", "deliveries", "stock_movements", "routes", "stock_requests"];
    for (const t of tables) {
      const rows = await ctx.db.query(t as any).withIndex("by_org", (q: any) => q.eq("org_id", org)).collect();
      data[t] = cleanAll(rows);
    }
    const emps = (await ctx.db.query("users").withIndex("by_org", (q) => q.eq("org_id", org)).collect()).map((u) => ({ user_id: u.user_id, name: u.name, email: u.email, employee_type: u.employee_type, role: u.role }));
    data.employees = emps;
    return data;
  },
});

// ---------------- stats: alerts / finance / reports ----------------
export const statsAlerts = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const user = await require(ctx, token, STAFF);
    const org = user.org_id!;
    const out: any[] = [];
    const sales = await ctx.db.query("sales").withIndex("by_org", (q) => q.eq("org_id", org)).collect();
    const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString();
    const overdue = sales.filter((s) => (s.remaining || 0) > 0 && String(s.created_at) < monthAgo);
    if (overdue.length) out.push({ id: "overdue", severity: "critical", icon: "time-outline", title: `${overdue.length} فاتورة متأخرة أكثر من 30 يوماً`, description: `إجمالي المتأخر: ${sumBy(overdue, "remaining")}` });
    const debtors = (await ctx.db.query("customers").withIndex("by_org", (q) => q.eq("org_id", org)).collect()).filter((c) => (c.balance || 0) > 0);
    if (debtors.length) {
      const avg = debtors.reduce((n, c) => n + c.balance, 0) / debtors.length;
      const risky = debtors.filter((c) => c.balance > avg * 3);
      if (risky.length) out.push({ id: "high-risk", severity: "warning", icon: "people-outline", title: `${risky.length} عميل عالي المخاطر`, description: risky.slice(0, 3).map((c) => c.name).join("، ") });
    }
    const week = new Date(Date.now() - 7 * 86400000).toISOString();
    const prev = new Date(Date.now() - 14 * 86400000).toISOString();
    const colls = await ctx.db.query("collections").withIndex("by_org", (q) => q.eq("org_id", org)).collect();
    const wSales = sumBy(sales.filter((s) => String(s.created_at) >= week), "total");
    const pSales = sumBy(sales.filter((s) => String(s.created_at) >= prev && String(s.created_at) < week), "total");
    const wCash = sumBy(sales.filter((s) => String(s.created_at) >= week), "paid_amount") + sumBy(colls.filter((c) => String(c.created_at) >= week), "amount");
    if (wSales > 0 && wCash / wSales < 0.5) out.push({ id: "low-collection", severity: "warning", icon: "cash-outline", title: "نسبة تحصيل منخفضة هذا الأسبوع", description: `نسبة التحصيل ${Math.round((wCash / wSales) * 100)}%` });
    if (pSales > 0 && wSales < pSales * 0.7) out.push({ id: "sales-drop", severity: "info", icon: "trending-down-outline", title: "انخفاض المبيعات", description: `انخفضت المبيعات ${Math.round((1 - wSales / pSales) * 100)}% مقارنة بالأسبوع السابق` });
    return out;
  },
});

export const statsFinance = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const user = await require(ctx, token, STAFF);
    const org = user.org_id!;
    const sales = (await ctx.db.query("sales").withIndex("by_org", (q) => q.eq("org_id", org)).collect()).filter((s) => !s.voided);
    const cash = sales.filter((s) => s.payment_type === "CASH");
    const credit = sales.filter((s) => s.payment_type === "CREDIT");
    const byCust: Record<string, number> = {};
    for (const s of sales) if (s.discount_amount) byCust[s.customer_name as string] = (byCust[s.customer_name as string] || 0) + s.discount_amount;
    const colls = await ctx.db.query("collections").withIndex("by_org", (q) => q.eq("org_id", org)).collect();
    const debtors = (await ctx.db.query("customers").withIndex("by_org", (q) => q.eq("org_id", org)).collect()).filter((c) => (c.balance || 0) > 0);
    const purchases = await ctx.db.query("purchases").withIndex("by_org", (q) => q.eq("org_id", org)).collect();
    const pReturns = await ctx.db.query("purchase_returns").withIndex("by_org", (q) => q.eq("org_id", org)).collect();
    return {
      sales_total: sumBy(sales, "total"), invoice_count: sales.length,
      cash_total: sumBy(cash, "total"), credit_total: sumBy(credit, "total"),
      cash_discounts: round2(cash.reduce((n, s) => n + (s.discount_amount || 0), 0)), credit_discounts: round2(credit.reduce((n, s) => n + (s.discount_amount || 0), 0)),
      collections_total: sumBy(colls, "amount"), collection_ops: colls.length,
      debt_customers: debtors.length, debts_total: round2(debtors.reduce((n, c) => n + c.balance, 0)),
      purchases_total: sumBy(purchases, "total"), purchase_returns_total: sumBy(pReturns, "total"),
      top_discount_customers: Object.entries(byCust).map(([name, amount]) => ({ name, amount: round2(amount) })).sort((a, b) => b.amount - a.amount).slice(0, 5),
    };
  },
});

function bucketKey(d: Date, period: string) {
  if (period === "month") return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  if (period === "week") { const x = new Date(d); const day = (x.getUTCDay() + 6) % 7; x.setUTCDate(x.getUTCDate() - day); return x.toISOString().slice(0, 10); }
  return d.toISOString().slice(0, 10);
}

export const statsReports = query({
  args: { token: v.string(), period: v.optional(v.string()) },
  handler: async (ctx, { token, period: p }) => {
    const user = await require(ctx, token, STAFF);
    const period = p || "day";
    if (!["day", "week", "month"].includes(period)) throw new Error("فترة غير صالحة");
    // Weekly / monthly reports are a Pro (paid licence) feature; trial orgs get daily only.
    if (period !== "day" && !hasFeature(await orgById(ctx, user.org_id!), "reports")) return { period, rows: [], totals: {}, locked: true };
    const n = period === "day" ? 7 : period === "week" ? 8 : 6;
    const today = new Date();
    const keys: string[] = [];
    for (let i = n - 1; i >= 0; i--) {
      let d: Date;
      if (period === "day") d = new Date(today.getTime() - i * 86400000);
      else if (period === "week") d = new Date(today.getTime() - i * 7 * 86400000);
      else { let y = today.getUTCFullYear(), m = today.getUTCMonth() - i; while (m < 0) { m += 12; y -= 1; } d = new Date(Date.UTC(y, m, 1)); }
      keys.push(bucketKey(d, period));
    }
    const start = period === "month" ? keys[0] + "-01" : keys[0];
    const org = user.org_id!;
    const isOwner = user.role === "OWNER";
    const costs: Record<string, number> = {};
    for (const pr of await ctx.db.query("products").withIndex("by_org", (q) => q.eq("org_id", org)).collect()) costs[pr.id] = pr.cost_price || 0;
    const buckets: Record<string, any> = {};
    for (const k of keys) buckets[k] = { key: k, sales: 0, collections: 0, returns: 0, profit: 0, count: 0 };
    for (const s of (await ctx.db.query("sales").withIndex("by_org", (q) => q.eq("org_id", org)).collect())) {
      if (s.voided || String(s.created_at) < start) continue;
      const k = bucketKey(new Date(s.created_at as string), period);
      if (buckets[k]) { buckets[k].sales += s.total; buckets[k].count += 1; buckets[k].profit += s.total - (s.items || []).reduce((m: number, it: any) => m + (costs[it.product_id] || 0) * linePieces(it), 0); }
    }
    for (const c of (await ctx.db.query("collections").withIndex("by_org", (q) => q.eq("org_id", org)).collect())) {
      if (String(c.created_at) < start) continue; const k = bucketKey(new Date(c.created_at as string), period); if (buckets[k]) buckets[k].collections += c.amount;
    }
    for (const r of (await ctx.db.query("sales_returns").withIndex("by_org", (q) => q.eq("org_id", org)).collect())) {
      if (String(r.created_at) < start) continue; const k = bucketKey(new Date(r.created_at as string), period);
      if (buckets[k]) { buckets[k].returns += r.total; buckets[k].profit -= r.total - (r.items || []).reduce((m: number, it: any) => m + (costs[it.product_id] || 0) * linePieces(it), 0); }
    }
    const rows = keys.map((k) => { const b = buckets[k]; for (const f of ["sales", "collections", "returns", "profit"]) b[f] = round2(b[f]); if (!isOwner) b.profit = null; return b; });
    const totals: any = {};
    for (const f of ["sales", "collections", "returns", "profit", "count"]) totals[f] = round2(rows.reduce((n2, r) => n2 + (r[f] || 0), 0));
    if (!isOwner) totals.profit = null;
    return { period, rows, totals };
  },
});

// ---------------- developer console ----------------
export const devStats = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    await require(ctx, token, DEV);
    const orgs = await ctx.db.query("organizations").collect();
    const users = await ctx.db.query("users").collect();
    const sales = await ctx.db.query("sales").collect();
    const lics = await ctx.db.query("licenses").collect();
    return { orgs: orgs.length, active_orgs: orgs.filter((o) => o.status === "ACTIVE").length, trials: orgs.filter((o) => o.plan === "TRIAL").length, licenses_ready: lics.filter((l) => l.status === "READY").length, users: users.length, sales: sales.length };
  },
});

export const devLicensesList = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => { await require(ctx, token, DEV); const r = await ctx.db.query("licenses").collect(); r.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))); return cleanAll(r); },
});

export const devLicensesCreate = mutation({
  args: { token: v.string(), org_name: v.string(), days: v.optional(v.number()), max_employees: v.optional(v.number()) },
  handler: async (ctx, a) => {
    await require(ctx, a.token, DEV);
    const doc = { id: newId(), code: genCode("LIC-"), org_name: a.org_name, days: a.days ?? 365, max_employees: a.max_employees ?? 10, status: "READY", created_at: nowIso() };
    await ctx.db.insert("licenses", doc);
    return doc;
  },
});

export const devLicensesDelete = mutation({
  args: { token: v.string(), id: v.string() },
  handler: async (ctx, { token, id }) => { await require(ctx, token, DEV); const l = (await ctx.db.query("licenses").withIndex("by_biz_id", (q) => q.eq("id", id)).unique()); if (l && l.status === "READY") await ctx.db.delete(l._id); return { ok: true }; },
});

export const devOrgs = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    await require(ctx, token, DEV);
    const orgs = await ctx.db.query("organizations").collect();
    const users = await ctx.db.query("users").collect();
    orgs.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    return orgs.map((o) => ({ ...clean(o), employees: users.filter((u) => u.org_id === o.id && u.role === "EMPLOYEE").length }));
  },
});

export const devPatchOrg = mutation({
  args: {
    token: v.string(), id: v.string(), status: v.optional(v.string()), extend_days: v.optional(v.number()),
    plan_tier: v.optional(v.string()), modules: v.optional(v.array(v.string())), max_employees: v.optional(v.number()),
    max_distributors: v.optional(v.union(v.number(), v.null())),
    max_customers: v.optional(v.union(v.number(), v.null())),
  },
  handler: async (ctx, a) => {
    await require(ctx, a.token, DEV);
    const org: any = await ctx.db.query("organizations").withIndex("by_biz_id", (q) => q.eq("id", a.id)).unique();
    if (!org) throw new Error("غير موجود");
    const patch: any = {};
    // Developer can override a company's tier, features and limits directly.
    if (a.plan_tier !== undefined) { if (!TIERS.includes(a.plan_tier)) throw new Error("فئة الخطة غير صالحة"); patch.plan_tier = a.plan_tier; }
    if (a.modules !== undefined) patch.modules = cleanModules(a.modules);
    if (a.max_employees !== undefined) patch.max_employees = Math.max(1, Math.floor(a.max_employees));
    if (a.max_customers !== undefined) patch.max_customers = a.max_customers == null ? null : Math.max(0, Math.floor(a.max_customers));
    if (a.max_distributors !== undefined) patch.max_distributors = a.max_distributors == null ? null : Math.max(0, Math.min(Math.floor(a.max_distributors), patch.max_employees ?? org.max_employees ?? Infinity));
    if (a.status === "ACTIVE" || a.status === "SUSPENDED") patch.status = a.status;
    if (a.extend_days) { const base = Math.max(Date.parse(org.expires_at), Date.now()); patch.expires_at = new Date(base + a.extend_days * 86400000).toISOString(); patch.plan = "LICENSE"; }
    await ctx.db.patch(org._id, patch);
    await audit(ctx, await getUser(ctx, a.token), "subscription.override", { org_id: org.id, before: { status: org.status, expires_at: org.expires_at, plan_tier: org.plan_tier, modules: org.modules, max_employees: org.max_employees, max_distributors: org.max_distributors }, after: patch });
    return clean(await ctx.db.get(org._id));
  },
});





export const devSettingsPayment = mutation({
  args: { token: v.string(), payment_address: v.optional(v.string()), whatsapp: v.optional(v.string()), instructions: v.optional(v.string()) },
  handler: async (ctx, a) => {
    await require(ctx, a.token, DEV);
    const body = { payment_address: a.payment_address ?? "", whatsapp: a.whatsapp ?? "", instructions: a.instructions ?? "" };
    const ex = await ctx.db.query("app_settings").withIndex("by_key", (q) => q.eq("key", "payment")).unique();
    if (ex) await ctx.db.patch(ex._id, body); else await ctx.db.insert("app_settings", { key: "payment", ...body });
    return body;
  },
});


export const devMonitoring = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    await require(ctx, token, DEV);
    const orgs = await ctx.db.query("organizations").collect();
    const users = await ctx.db.query("users").collect();
    const sales = await ctx.db.query("sales").collect();
    const products = await ctx.db.query("products").collect();
    const customers = await ctx.db.query("customers").collect();
    const week = new Date(Date.now() - 7 * 86400000).toISOString();
    return orgs.map((o) => {
      const os = sales.filter((s) => s.org_id === o.id);
      return { id: o.id, name: o.name, status: o.status, plan: o.plan, expires_at: o.expires_at, users: users.filter((u) => u.org_id === o.id).length, products: products.filter((p) => p.org_id === o.id).length, customers: customers.filter((c) => c.org_id === o.id).length, sales: os.length, sales_week: os.filter((s) => String(s.created_at) >= week).length, revenue: sumBy(os, "total") };
    });
  },
});

export const devVersionsList = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => { await require(ctx, token, DEV); const r = await ctx.db.query("app_versions").collect(); r.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))); return cleanAll(r); },
});

export const devVersionCreate = mutation({
  args: { token: v.string(), platform: v.string(), version: v.string(), force_update: v.optional(v.boolean()), release_notes: v.optional(v.string()), store_url: v.optional(v.string()) },
  handler: async (ctx, a) => {
    await require(ctx, a.token, DEV);
    const doc = { id: newId(), platform: a.platform, version: a.version, force_update: a.force_update ?? false, release_notes: a.release_notes ?? "", store_url: a.store_url ?? "", created_at: nowIso() };
    await ctx.db.insert("app_versions", doc);
    return doc;
  },
});

export const devVersionDelete = mutation({
  args: { token: v.string(), id: v.string() },
  handler: async (ctx, { token, id }) => { await require(ctx, token, DEV); const v2 = (await ctx.db.query("app_versions").collect()).find((x) => x.id === id); if (v2) await ctx.db.delete(v2._id); return { ok: true }; },
});

const ORG_COLLECTIONS = ["products", "customers", "customer_types", "sales", "collections", "sales_returns", "purchases", "purchase_returns", "deliveries", "distributor_inventory", "stock_movements", "routes", "stock_requests", "invitations", "counters", "agent_locations", "price_history", "upgrade_requests", "payment_vouchers", "warehouse_returns", "supplier_payments", "suppliers"];

export const devDeletionReview = mutation({
  args: { token: v.string(), id: v.string(), action: v.string(), note: v.optional(v.string()) },
  handler: async (ctx, a) => {
    await require(ctx, a.token, DEV);
    // Developers can no longer delete accounts/organizations — owners delete their own account directly.
    if (a.action === "approve") throw new Error("حذف الحسابات متاح للمالك والموظفين فقط");
    const req: any = (await ctx.db.query("deletion_requests").withIndex("by_biz_id", (q) => q.eq("id", a.id)).unique());
    if (!req || req.status !== "PENDING") throw new Error("الطلب غير موجود");
    await ctx.db.patch(req._id, { status: "REJECTED", reviewed_at: nowIso() });
    return { ok: true, status: "REJECTED" };
  },
});

async function wipeOrg(ctx: any, org: string) {
  for (const c of ORG_COLLECTIONS) {
    const rows = await ctx.db.query(c as any).filter((q: any) => q.eq(q.field("org_id"), org)).collect();
    for (const r of rows) await ctx.db.delete(r._id);
  }
  for (const r of await ctx.db.query("deletion_requests").withIndex("by_org", (q: any) => q.eq("org_id", org)).collect()) await ctx.db.delete(r._id);
  const members = await ctx.db.query("users").withIndex("by_org", (q: any) => q.eq("org_id", org)).collect();
  for (const m of members) await ctx.db.patch(m._id, { role: null, employee_type: null, org_id: null });
  const o = await ctx.db.query("organizations").withIndex("by_biz_id", (q: any) => q.eq("id", org)).unique();
  if (o) await ctx.db.delete(o._id);
}
