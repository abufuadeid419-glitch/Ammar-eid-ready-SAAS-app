import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
import {
  consumeFifo,
  AGENT,
  ANY_ORG,
  clean,
  cleanAll,
  distInv,
  docOrgUnique,
  geoFields,
  isAgent,
  logMovement,
  newId,
  nextNo,
  nowIso,
  orgCustomer,
  orgMoney,
  priceFor,
  require,
  round2,
  toBase,
} from "./lib";

const lineItem = v.object({
  product_id: v.string(),
  quantity: v.number(),
  unit: v.optional(v.string()), // "PIECE" | "PACKAGE"
  price: v.optional(v.number()),
});

// GET /api/sales  (ANY_ORG; agents see only their own, newest first)
export const list = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const user = await require(ctx, token, ANY_ORG);
    const rows = isAgent(user)
      ? await ctx.db
          .query("sales")
          .withIndex("by_distributor", (q) => q.eq("distributor_id", user.user_id))
          .filter((q) => q.eq(q.field("org_id"), user.org_id!))
          .collect()
      : await ctx.db.query("sales").withIndex("by_org", (q) => q.eq("org_id", user.org_id!)).collect();
    rows.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    return cleanAll(rows);
  },
});

// POST /api/sales  (AGENT) — sells from the distributor's own inventory.
export const create = mutation({
  args: {
    token: v.string(),
    id: v.optional(v.string()),
    customer_id: v.string(),
    items: v.array(lineItem),
    paid_amount: v.optional(v.number()),
    notes: v.optional(v.string()),
    discount_type: v.optional(v.string()), // NONE | PERCENT | FIXED
    discount_value: v.optional(v.number()),
    lat: v.optional(v.union(v.number(), v.null())),
    lng: v.optional(v.union(v.number(), v.null())),
    client_created_at: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, a) => {
    const user = await require(ctx, a.token, AGENT);
    if (a.id) {
      const ex = await docOrgUnique(ctx, "sales", a.id, user.org_id!);
      if (ex) return clean(ex);
    }
    const cust = await orgCustomer(ctx, user, a.customer_id);
    if (!a.items.length) throw new Error("أضف منتجاً واحداً على الأقل");
    if (a.items.some((it: any) => !(it.quantity > 0) || it.quantity > 1e6)) throw new Error("كمية غير صالحة");

    const { rate, currency } = await orgMoney(ctx, user.org_id!);

    const items: any[] = [];
    let total = 0;
    for (const it of a.items) {
      const inv = await distInv(ctx, user.user_id, it.product_id);
      const prod: any = await docOrgUnique(ctx, "products", it.product_id, user.org_id!);
      const ppp = Math.max(1, Math.round(prod?.pieces_per_package ?? 1));
      const isPackage = it.unit === "PACKAGE";
      const pieces = round2(it.quantity * (isPackage ? ppp : 1)); // stock is counted in pieces
      if (!inv || (inv.quantity ?? 0) < pieces - 0.0001) throw new Error(`الكمية غير متوفرة لديك: ${inv?.product_name ?? prod?.name ?? ""}`);
      // Piece price in the product's own currency → base (SYP) at the CURRENT rate.
      const cur = prod?.price_currency === "USD" ? "USD" : "SYP";
      const piecePriceCur = await priceFor(ctx, user.org_id!, cust, it.product_id);
      const piecePriceBase = toBase(piecePriceCur, cur, rate);
      const unitPrice = isPackage ? round2(piecePriceBase * ppp) : piecePriceBase; // price per sold unit, in SYP
      const line = round2(it.quantity * unitPrice);
      total += line;
      items.push({
        product_id: it.product_id,
        product_name: inv.product_name ?? prod?.name ?? "",
        unit: isPackage ? "PACKAGE" : "PIECE",
        unit_label: isPackage ? prod?.package_unit ?? "كرتونة" : prod?.unit ?? "قطعة",
        quantity: it.quantity,
        pieces_per_package: ppp,
        pieces,
        price_currency: cur,
        orig_unit_price: isPackage ? round2(piecePriceCur * ppp) : piecePriceCur, // in product currency (historical reference)
        price: unitPrice, // SYP (kept for back-compat with existing readers)
        unit_price: unitPrice, // SYP
        total: line,
      });
    }

    const subtotal = round2(total);
    let discount = 0;
    if (a.discount_type === "PERCENT") discount = round2((subtotal * Math.min(a.discount_value ?? 0, 100)) / 100);
    else if (a.discount_type === "FIXED") discount = round2(Math.min(a.discount_value ?? 0, subtotal));
    total = round2(subtotal - discount);
    const paid = Math.min(a.paid_amount ?? 0, total);

    for (const it of items) {
      const inv = await distInv(ctx, user.user_id, it.product_id);
      if (inv) await ctx.db.patch(inv._id, { quantity: round2((inv.quantity ?? 0) - it.pieces) });
      await consumeFifo(ctx, user.org_id!, it.product_id, it.pieces, user.name ?? null);
      await logMovement(ctx, user.org_id!, it.product_id, it.product_name, "SALE", -it.pieces, user.name ?? null, "AGENT");
    }

    await ctx.db.patch(cust._id, { balance: round2((cust.balance ?? 0) + round2(total - paid)) });
    if (a.lat !== undefined && a.lat !== null && (cust.lat === undefined || cust.lat === null))
      await ctx.db.patch(cust._id, { lat: a.lat, lng: a.lng ?? null });

    const doc = {
      id: a.id || newId(),
      ...geoFields(a),
      org_id: user.org_id!,
      invoice_no: await nextNo(ctx, user.org_id!, "sale", "INV"),
      customer_id: cust.id,
      customer_name: cust.name,
      distributor_id: user.user_id,
      distributor_name: user.name ?? null,
      items,
      subtotal,
      discount_type: discount ? a.discount_type : "NONE",
      discount_value: discount ? a.discount_value ?? 0 : 0,
      discount_amount: discount,
      total,
      paid_amount: paid,
      remaining: round2(total - paid),
      payment_type: paid >= total ? "CASH" : "CREDIT",
      notes: a.notes ?? "",
      exchange_rate: rate,
      currency,
      created_at: nowIso(),
    };
    await ctx.db.insert("sales", doc);
    return doc;
  },
});
