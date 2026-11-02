import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
import { ANY_ORG, OWNER, clean, cleanAll, logMovement, newId, nowIso, require, round2 } from "./lib";

// GET /api/products  (ANY_ORG)
export const list = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const user = await require(ctx, token, ANY_ORG);
    const items = await ctx.db
      .query("products")
      .withIndex("by_org", (q) => q.eq("org_id", user.org_id!))
      .collect();
    items.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    return cleanAll(items);
  },
});

// POST /api/products  (OWNER)
export const create = mutation({
  args: {
    token: v.string(),
    name: v.string(),
    category: v.optional(v.string()),
    unit: v.optional(v.string()),
    cost_price: v.optional(v.number()),
    sale_price: v.optional(v.number()),
    stock: v.optional(v.number()),
    min_stock: v.optional(v.number()),
    price_currency: v.optional(v.string()),
    pieces_per_package: v.optional(v.number()),
    package_unit: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const user = await require(ctx, a.token, OWNER);
    const ppp = Math.max(1, Math.round(a.pieces_per_package ?? 1));
    const salePiece = a.sale_price ?? 0;
    const doc = {
      id: newId(),
      org_id: user.org_id!,
      name: a.name,
      category: a.category ?? "",
      unit: a.unit ?? "قطعة",
      cost_price: a.cost_price ?? 0,
      sale_price: salePiece,
      stock: a.stock ?? 0,
      min_stock: a.min_stock ?? 0,
      price_currency: a.price_currency === "USD" ? "USD" : "SYP",
      pieces_per_package: ppp,
      package_unit: a.package_unit ?? "كرتونة",
      package_price: round2(salePiece * ppp),
      created_at: nowIso(),
    };
    await ctx.db.insert("products", doc);
    if (doc.stock) await logMovement(ctx, user.org_id!, doc.id, doc.name, "ADJUSTMENT", doc.stock, user.name ?? null);
    return doc;
  },
});

// PUT /api/products/{pid}  (OWNER)
export const update = mutation({
  args: {
    token: v.string(),
    id: v.string(),
    name: v.string(),
    category: v.optional(v.string()),
    unit: v.optional(v.string()),
    cost_price: v.optional(v.number()),
    sale_price: v.optional(v.number()),
    stock: v.optional(v.number()),
    min_stock: v.optional(v.number()),
    price_currency: v.optional(v.string()),
    pieces_per_package: v.optional(v.number()),
    package_unit: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const user = await require(ctx, a.token, OWNER);
    const old = await ctx.db
      .query("products")
      .withIndex("by_biz_id", (q) => q.eq("id", a.id))
      .filter((q) => q.eq(q.field("org_id"), user.org_id!))
      .unique();
    if (!old) throw new Error("المنتج غير موجود");
    const ppp = Math.max(1, Math.round(a.pieces_per_package ?? (old as any).pieces_per_package ?? 1));
    const salePiece = a.sale_price ?? 0;
    const patch = {
      name: a.name,
      category: a.category ?? "",
      unit: a.unit ?? "قطعة",
      cost_price: a.cost_price ?? 0,
      sale_price: salePiece,
      stock: a.stock ?? 0,
      min_stock: a.min_stock ?? 0,
      price_currency: a.price_currency === "USD" ? "USD" : "SYP",
      pieces_per_package: ppp,
      package_unit: a.package_unit ?? (old as any).package_unit ?? "كرتونة",
      package_price: round2(salePiece * ppp),
    };
    await ctx.db.patch(old._id, patch);
    if ((old.stock ?? 0) !== patch.stock)
      await logMovement(ctx, user.org_id!, a.id, a.name, "ADJUSTMENT", Math.round((patch.stock - (old.stock ?? 0)) * 100) / 100, user.name ?? null);
    if ((old.sale_price ?? 0) !== patch.sale_price)
      await ctx.db.insert("price_history", {
        org_id: user.org_id!,
        product_id: a.id,
        product_name: a.name,
        old_price: old.sale_price ?? 0,
        new_price: patch.sale_price,
        by: user.name ?? null,
        at: nowIso(),
      });
    return clean(await ctx.db.get(old._id));
  },
});

// DELETE /api/products/{pid}  (OWNER)
export const remove = mutation({
  args: { token: v.string(), id: v.string() },
  handler: async (ctx, a) => {
    const user = await require(ctx, a.token, OWNER);
    const doc = await ctx.db
      .query("products")
      .withIndex("by_biz_id", (q) => q.eq("id", a.id))
      .filter((q) => q.eq(q.field("org_id"), user.org_id!))
      .unique();
    if (doc) await ctx.db.delete(doc._id);
    return { ok: true };
  },
});
