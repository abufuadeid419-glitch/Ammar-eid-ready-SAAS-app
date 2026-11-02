import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
import {
  linePieces,
  unitQty,
  AGENT,
  ANY_ORG,
  OWNER,
  STAFF,
  clean,
  cleanAll,
  checkLowStock,
  docById,
  docOrgUnique,
  invAdjust,
  logMovement,
  newId,
  notify,
  nowIso,
  orgOwnerIds,
  require,
  round2,
} from "./lib";

const qtyItem = v.object({ product_id: v.string(), quantity: v.number(), unit: v.optional(v.string()) });

// ========================= Deliveries (warehouse -> distributor) =========================
export const list = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const user = await require(ctx, token, ANY_ORG);
    const rows =
      user.employee_type === "FIELD_AGENT"
        ? await ctx.db
            .query("deliveries")
            .withIndex("by_distributor", (q) => q.eq("distributor_id", user.user_id))
            .filter((q) => q.eq(q.field("org_id"), user.org_id!))
            .collect()
        : await ctx.db.query("deliveries").withIndex("by_org", (q) => q.eq("org_id", user.org_id!)).collect();
    rows.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    return cleanAll(rows);
  },
});

// Shared creator so stock-request fulfilment can reuse it (mirror create_delivery).
async function makeDelivery(ctx: any, user: any, distributor_id: string, items: any[], notes: string) {
  const dist = await ctx.db
    .query("users")
    .withIndex("by_user_id", (q: any) => q.eq("user_id", distributor_id))
    .unique();
  if (!dist || dist.org_id !== user.org_id || dist.employee_type !== "FIELD_AGENT") throw new Error("الموزع غير موجود");
  const lines: any[] = [];
  for (const it of items) {
    const prod = await docOrgUnique(ctx, "products", it.product_id, user.org_id);
    const u = unitQty(prod, it.unit, it.quantity);
    if (!prod || (prod.stock ?? 0) < u.pieces - 0.0001) throw new Error(`الكمية غير متوفرة في المستودع: ${prod?.name ?? ""}`);
    lines.push({ product_id: prod.id, product_name: prod.name, ...u });
  }
  for (const it of lines) {
    const prod = await docOrgUnique(ctx, "products", it.product_id, user.org_id);
    if (prod) await ctx.db.patch(prod._id, { stock: round2((prod.stock ?? 0) - it.pieces) });
    await logMovement(ctx, user.org_id, it.product_id, it.product_name, "DELIVERY", -it.pieces, user.name ?? null, "WAREHOUSE");
  }
  const doc = {
    id: newId(),
    org_id: user.org_id,
    distributor_id: dist.user_id,
    distributor_name: dist.name ?? null,
    items: lines,
    notes,
    status: "PENDING",
    created_at: nowIso(),
  };
  await ctx.db.insert("deliveries", doc);
  await notify(ctx, [dist.user_id], "delivery", "شحنة بضاعة جديدة", `لديك شحنة من ${lines.length} صنف بانتظار التأكيد`);
  await checkLowStock(ctx, user.org_id, lines.map((i) => i.product_id));
  return doc;
}

export const create = mutation({
  args: { token: v.string(), distributor_id: v.string(), items: v.array(qtyItem), notes: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const user = await require(ctx, a.token, OWNER);
    return makeDelivery(ctx, user, a.distributor_id, a.items, a.notes ?? "");
  },
});

export const confirm = mutation({
  args: { token: v.string(), id: v.string() },
  handler: async (ctx, { token, id }) => {
    const user = await require(ctx, token, AGENT);
    const d = await docById(ctx, "deliveries", id);
    if (!d || d.distributor_id !== user.user_id || d.status !== "PENDING") throw new Error("الشحنة غير موجودة أو تمت معالجتها");
    for (const it of d.items) await invAdjust(ctx, user.org_id!, user.user_id, it.product_id, it.product_name, linePieces(it));
    await ctx.db.patch(d._id, { status: "CONFIRMED", handled_at: nowIso() });
    await notify(ctx, await orgOwnerIds(ctx, user.org_id!), "delivery_confirmed", "تم استلام الشحنة", `${user.name ?? ""} أكد استلام الشحنة`);
    return clean(await ctx.db.get(d._id));
  },
});

export const reject = mutation({
  args: { token: v.string(), id: v.string() },
  handler: async (ctx, { token, id }) => {
    const user = await require(ctx, token, AGENT);
    const d = await docById(ctx, "deliveries", id);
    if (!d || d.distributor_id !== user.user_id || d.status !== "PENDING") throw new Error("الشحنة غير موجودة أو تمت معالجتها");
    for (const it of d.items) {
      const prod = await docOrgUnique(ctx, "products", it.product_id, user.org_id!);
      if (prod) await ctx.db.patch(prod._id, { stock: round2((prod.stock ?? 0) + linePieces(it)) });
      await logMovement(ctx, user.org_id!, it.product_id, it.product_name, "DELIVERY_REJECTED", linePieces(it), user.name ?? null, "WAREHOUSE");
    }
    await ctx.db.patch(d._id, { status: "REJECTED", handled_at: nowIso() });
    await notify(ctx, await orgOwnerIds(ctx, user.org_id!), "delivery_rejected", "تم رفض شحنة", `${user.name ?? ""} رفض الشحنة وأعيدت الكمية للمستودع`);
    return clean(await ctx.db.get(d._id));
  },
});

// ========================= Distributor inventory views =========================
export const myInventory = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const user = await require(ctx, token, AGENT);
    const inv = await ctx.db.query("distributor_inventory").withIndex("by_distributor", (q) => q.eq("distributor_id", user.user_id)).collect();
    const prods = new Map(
      (await ctx.db.query("products").withIndex("by_org", (q) => q.eq("org_id", user.org_id!)).collect()).map((p) => [p.id, p]),
    );
    return inv
      .filter((i) => prods.has(i.product_id))
      .map((i) => {
        const p: any = prods.get(i.product_id)!;
        return {
          ...clean(i),
          sale_price: p.sale_price,
          min_stock: p.min_stock ?? 0,
          unit: p.unit ?? "قطعة",
          package_unit: p.package_unit ?? "كرتونة",
          pieces_per_package: Math.max(1, Math.round(p.pieces_per_package ?? 1)),
          price_currency: p.price_currency === "USD" ? "USD" : "SYP",
        };
      });
  },
});

export const distributorsInventory = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const user = await require(ctx, token, STAFF);
    const rows = await ctx.db.query("distributor_inventory").withIndex("by_org", (q) => q.eq("org_id", user.org_id!)).collect();
    return cleanAll(rows.filter((r) => (r.quantity ?? 0) > 0));
  },
});

// ========================= Stock requests (distributor asks owner to top-up) =========================
export const listRequests = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const user = await require(ctx, token, ANY_ORG);
    const rows =
      user.employee_type === "FIELD_AGENT"
        ? await ctx.db
            .query("stock_requests")
            .withIndex("by_distributor", (q) => q.eq("distributor_id", user.user_id))
            .filter((q) => q.eq(q.field("org_id"), user.org_id!))
            .collect()
        : await ctx.db.query("stock_requests").withIndex("by_org", (q) => q.eq("org_id", user.org_id!)).collect();
    rows.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    return cleanAll(rows);
  },
});

export const createRequest = mutation({
  args: { token: v.string(), id: v.optional(v.string()), items: v.array(qtyItem), note: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const user = await require(ctx, a.token, AGENT);
    if (a.id) {
      const ex = await docOrgUnique(ctx, "stock_requests", a.id, user.org_id!);
      if (ex) return clean(ex);
    }
    if (!a.items.length) throw new Error("اختر منتجاً واحداً على الأقل");
    const items: any[] = [];
    for (const it of a.items) {
      const prod = await docOrgUnique(ctx, "products", it.product_id, user.org_id!);
      if (prod) items.push({ product_id: prod.id, product_name: prod.name, ...unitQty(prod, it.unit, it.quantity) });
    }
    const doc = {
      id: a.id || newId(),
      org_id: user.org_id!,
      distributor_id: user.user_id,
      distributor_name: user.name ?? null,
      items,
      note: a.note ?? "",
      status: "PENDING",
      created_at: nowIso(),
    };
    await ctx.db.insert("stock_requests", doc);
    await notify(ctx, await orgOwnerIds(ctx, user.org_id!), "stock_request", "طلب تعبئة مخزون", `${user.name ?? ""} طلب ${items.length} صنف`);
    return doc;
  },
});

export const fulfillRequest = mutation({
  args: { token: v.string(), id: v.string() },
  handler: async (ctx, { token, id }) => {
    const user = await require(ctx, token, OWNER);
    const req = await docOrgUnique(ctx, "stock_requests", id, user.org_id!);
    if (!req || req.status !== "PENDING") throw new Error("الطلب غير موجود أو تمت معالجته");
    const delivery = await makeDelivery(ctx, user, req.distributor_id, req.items, "تعبئة حسب طلب الموزع");
    await ctx.db.patch(req._id, { status: "FULFILLED", delivery_id: delivery.id, handled_at: nowIso() });
    return clean(await ctx.db.get(req._id));
  },
});

export const rejectRequest = mutation({
  args: { token: v.string(), id: v.string() },
  handler: async (ctx, { token, id }) => {
    const user = await require(ctx, token, OWNER);
    const req = await docOrgUnique(ctx, "stock_requests", id, user.org_id!);
    if (req && req.status === "PENDING") await ctx.db.patch(req._id, { status: "REJECTED", handled_at: nowIso() });
    return req ? clean(await ctx.db.get(req._id)) : null;
  },
});
