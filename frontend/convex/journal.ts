import { v } from "convex/values";

import { internalQuery, query } from "./_generated/server";
import { STAFF, require, round2 } from "./lib";

// Role lookup for the HTTP router's read-only guard (accountants may not write).
export const roleOf = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    if (!token) return null;
    const s = await ctx.db.query("user_sessions").withIndex("by_token", (q: any) => q.eq("session_token", token)).unique();
    if (!s) return null;
    const u: any = await ctx.db.query("users").withIndex("by_user_id", (q: any) => q.eq("user_id", s.user_id)).unique();
    return u ? { role: u.role ?? null, employee_type: u.employee_type ?? null } : null;
  },
});

const unitOf = (it: any) => it.unit_label || (it.unit === "PACKAGE" ? "كرتونة" : "قطعة");
const lines = (items: any[] = []) =>
  items.map((it) => ({ product: it.product_name, quantity: it.quantity, unit: unitOf(it), pieces: it.pieces ?? it.quantity, price: it.unit_price ?? it.price ?? null, total: it.total ?? null }));

// GET /api/accounting/journal?from=ISO&to=ISO (OWNER, ACCOUNTANT)
// Every financial / stock document with full detail + suggested double-entry accounts, oldest first,
// ready to be posted into an external accounting system.
export const journal = query({
  args: { token: v.string(), from: v.optional(v.string()), to: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const user = await require(ctx, a.token, STAFF);
    const org = user.org_id!;
    const from = a.from || "0000";
    const to = a.to || "9999";
    const all = async (t: string) => (await ctx.db.query(t as any).withIndex("by_org", (q: any) => q.eq("org_id", org)).collect()).filter((r: any) => String(r.created_at) >= from && String(r.created_at) <= to);
    const out: any[] = [];
    const add = (e: any) => out.push({ ...e, amount: round2(e.amount ?? 0) });

    for (const s of await all("sales")) {
      add({
        date: s.created_at, type: "SALE", type_label: s.voided ? "فاتورة مبيعات (ملغاة)" : "فاتورة مبيعات", ref: s.invoice_no, party: s.customer_name, by: s.distributor_name,
        amount: s.total, debit_account: s.payment_type === "CASH" ? "الصندوق" : `ذمم العملاء - ${s.customer_name}`, credit_account: "إيرادات المبيعات",
        details: { subtotal: s.subtotal, discount: s.discount_amount ?? 0, discount_type: s.discount_type, paid: s.paid_amount, remaining: s.remaining, payment_type: s.payment_type === "CASH" ? "نقدي" : s.payment_type === "CREDIT" ? "آجل" : s.payment_type, voided: !!s.voided, void_reason: s.void_reason ?? "", notes: s.notes ?? "" },
        lines: lines(s.items),
      });
    }
    for (const c of await all("collections"))
      add({ date: c.created_at, type: "COLLECTION", type_label: "سند قبض", ref: c.receipt_no, party: c.customer_name, by: c.collector_name, amount: c.amount, debit_account: "الصندوق", credit_account: `ذمم العملاء - ${c.customer_name}`, details: { input: c.amount_input, input_currency: c.input_currency === "USD" ? "دولار" : "ليرة", exchange_rate: c.exchange_rate, notes: c.notes ?? "" }, lines: [] });
    for (const p of await all("payment_vouchers"))
      add({ date: p.created_at, type: "PAYMENT", type_label: "سند صرف لعميل", ref: p.voucher_no, party: p.customer_name, by: p.distributor_name, amount: p.amount, debit_account: `ذمم العملاء - ${p.customer_name}`, credit_account: "الصندوق", details: { input: p.amount_input, input_currency: p.input_currency === "USD" ? "دولار" : "ليرة", exchange_rate: p.exchange_rate, notes: p.notes ?? "" }, lines: [] });
    for (const r of await all("sales_returns"))
      add({ date: r.created_at, type: "SALES_RETURN", type_label: "مرتجع مبيعات", ref: r.return_no, party: r.customer_name, by: r.distributor_name, amount: r.total, debit_account: "مردودات المبيعات", credit_account: `ذمم العملاء - ${r.customer_name}`, details: { reason: r.reason ?? "" }, lines: lines(r.items) });
    for (const p of await all("purchases"))
      add({ date: p.created_at, type: "PURCHASE", type_label: "مشتريات", ref: "", party: p.supplier || "بدون مورد", by: null, amount: p.total, debit_account: "المخزون", credit_account: `ذمم الموردين - ${p.supplier || "بدون مورد"}`, details: { unit_cost: p.unit_cost, piece_cost: p.piece_cost ?? p.unit_cost }, lines: lines([{ ...p, price: p.unit_cost }]) });
    for (const p of await all("purchase_returns"))
      add({ date: p.created_at, type: "PURCHASE_RETURN", type_label: "مرتجع مشتريات", ref: p.return_no, party: p.supplier || "بدون مورد", by: null, amount: p.total, debit_account: `ذمم الموردين - ${p.supplier || "بدون مورد"}`, credit_account: "المخزون", details: { reason: p.reason ?? "" }, lines: lines([{ ...p, price: p.unit_cost }]) });
    for (const p of await all("supplier_payments"))
      add({ date: p.created_at, type: "SUPPLIER_PAYMENT", type_label: "سند صرف لمورد", ref: p.voucher_no, party: p.supplier, by: p.created_by_name, amount: p.amount, debit_account: `ذمم الموردين - ${p.supplier}`, credit_account: "الصندوق", details: { input: p.amount_input, input_currency: p.input_currency === "USD" ? "دولار" : "ليرة", exchange_rate: p.exchange_rate, notes: p.notes ?? "" }, lines: [] });
    for (const d of await all("deliveries"))
      add({ date: d.created_at, type: "DELIVERY", type_label: "تسليم بضاعة لموزع (حركة مخزنية)", ref: "", party: d.distributor_name, by: null, amount: 0, debit_account: `عهدة الموزع - ${d.distributor_name}`, credit_account: "مخزون المستودع", details: { status: d.status, notes: d.notes ?? "" }, lines: lines(d.items) });
    for (const w of await all("warehouse_returns"))
      add({ date: w.created_at, type: "WAREHOUSE_RETURN", type_label: "إرجاع بضاعة للمستودع (حركة مخزنية)", ref: w.return_no, party: w.distributor_name, by: w.handled_by ?? null, amount: 0, debit_account: "مخزون المستودع", credit_account: `عهدة الموزع - ${w.distributor_name}`, details: { status: w.status, notes: w.notes ?? "" }, lines: lines(w.items) });

    out.sort((x, y) => String(x.date).localeCompare(String(y.date)));
    const totals: Record<string, { label: string; count: number; amount: number }> = {};
    for (const e of out) {
      const t = (totals[e.type] ??= { label: e.type_label.replace(" (ملغاة)", ""), count: 0, amount: 0 });
      t.count++;
      if (!e.details?.voided) t.amount = round2(t.amount + e.amount);
    }
    return { entries: out, totals: Object.entries(totals).map(([type, t]) => ({ type, ...t })) };
  },
});
