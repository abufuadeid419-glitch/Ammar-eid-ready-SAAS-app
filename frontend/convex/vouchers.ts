import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
import { AGENT, ANY_ORG, clean, cleanAll, docOrgUnique, geoFields, isAgent, newId, nextNo, nowIso, orgCustomer, orgMoney, require, round2, toBase } from "./lib";

// GET /api/payment-vouchers (ANY_ORG; agents see only their own).
export const list = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const user = await require(ctx, token, ANY_ORG);
    const rows = isAgent(user)
      ? await ctx.db
          .query("payment_vouchers")
          .withIndex("by_distributor", (q) => q.eq("distributor_id", user.user_id))
          .filter((q) => q.eq(q.field("org_id"), user.org_id!))
          .collect()
      : await ctx.db.query("payment_vouchers").withIndex("by_org", (q) => q.eq("org_id", user.org_id!)).collect();
    rows.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    return cleanAll(rows);
  },
});

// POST /api/payment-vouchers (AGENT) — cash refund to a customer with a credit balance.
export const create = mutation({
  args: {
    token: v.string(),
    id: v.optional(v.string()),
    customer_id: v.string(),
    amount: v.number(),
    notes: v.optional(v.string()),
    currency: v.optional(v.string()), // entry currency: "SYP" | "USD"
    lat: v.optional(v.union(v.number(), v.null())),
    lng: v.optional(v.union(v.number(), v.null())),
    client_created_at: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, a) => {
    const user = await require(ctx, a.token, AGENT);
    const cust = await orgCustomer(ctx, user, a.customer_id);
    if (a.id) {
      const ex = await docOrgUnique(ctx, "payment_vouchers", a.id, user.org_id!);
      if (ex) return clean(ex);
    }
    if (a.amount <= 0) throw new Error("المبلغ غير صالح");
    const { rate, currency } = await orgMoney(ctx, user.org_id!);
    const inputCur = a.currency === "USD" ? "USD" : "SYP";
    const amountBase = toBase(a.amount, inputCur, rate);
    const credit = -(cust.balance ?? 0);
    if (amountBase > credit + 0.001) throw new Error(`المبلغ أكبر من الرصيد الدائن للعميل (${round2(Math.max(credit, 0))})`);
    await ctx.db.patch(cust._id, { balance: round2((cust.balance ?? 0) + amountBase) });
    const doc = {
      id: a.id || newId(),
      ...geoFields(a),
      org_id: user.org_id!,
      voucher_no: await nextNo(ctx, user.org_id!, "pay", "PAY"),
      customer_id: cust.id,
      customer_name: cust.name,
      amount: amountBase,
      amount_input: round2(a.amount),
      input_currency: inputCur,
      exchange_rate: rate,
      currency,
      notes: a.notes ?? "",
      distributor_id: user.user_id,
      distributor_name: user.name ?? null,
      created_at: nowIso(),
    };
    await ctx.db.insert("payment_vouchers", doc);
    return doc;
  },
});
