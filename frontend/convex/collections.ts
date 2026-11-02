import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
import {
  ANY_ORG,
  clean,
  cleanAll,
  docOrgUnique,
  geoFields,
  isAgent,
  newId,
  nextNo,
  nowIso,
  orgCustomer,
  orgMoney,
  require,
  round2,
  toBase,
} from "./lib";

// GET /api/collections  (ANY_ORG; agents see only what they collected)
export const list = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const user = await require(ctx, token, ANY_ORG);
    const rows = isAgent(user)
      ? await ctx.db
          .query("collections")
          .withIndex("by_collector", (q) => q.eq("collector_id", user.user_id))
          .filter((q) => q.eq(q.field("org_id"), user.org_id!))
          .collect()
      : await ctx.db.query("collections").withIndex("by_org", (q) => q.eq("org_id", user.org_id!)).collect();
    rows.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    return cleanAll(rows);
  },
});

// POST /api/collections  (ANY_ORG) — pays down a customer's debt.
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
    const user = await require(ctx, a.token, ANY_ORG);
    const cust = await orgCustomer(ctx, user, a.customer_id);
    if (a.id) {
      const ex = await docOrgUnique(ctx, "collections", a.id, user.org_id!);
      if (ex) return clean(ex);
    }
    if (a.amount <= 0) throw new Error("المبلغ غير صالح");
    // Convert the entered amount to base (SYP) at the current rate; stamp it historically.
    const { rate, currency } = await orgMoney(ctx, user.org_id!);
    const inputCur = a.currency === "USD" ? "USD" : "SYP";
    const amountBase = toBase(a.amount, inputCur, rate);
    if (amountBase > (cust.balance ?? 0) + 0.001) throw new Error("المبلغ أكبر من دين العميل");

    await ctx.db.patch(cust._id, { balance: round2((cust.balance ?? 0) - amountBase) });
    const doc = {
      id: a.id || newId(),
      ...geoFields(a),
      org_id: user.org_id!,
      receipt_no: await nextNo(ctx, user.org_id!, "col", "RCV"),
      customer_id: cust.id,
      customer_name: cust.name,
      amount: amountBase,
      amount_input: round2(a.amount),
      input_currency: inputCur,
      exchange_rate: rate,
      currency,
      notes: a.notes ?? "",
      collector_id: user.user_id,
      collector_name: user.name ?? null,
      created_at: nowIso(),
    };
    await ctx.db.insert("collections", doc);
    return doc;
  },
});
