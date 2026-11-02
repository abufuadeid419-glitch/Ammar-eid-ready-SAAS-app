import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
import {
  linePieces,
  unitQty,
  orgMoney,
  toBase,
  AGENT,
  ANY_ORG,
  OWNER,
  clean,
  cleanAll,
  distInv,
  docOrgUnique,
  geoFields,
  invAdjust,
  isAgent,
  logMovement,
  newId,
  nextNo,
  notify,
  nowIso,
  orgCustomer,
  orgOwnerIds,
  priceFor,
  require,
  round2,
} from "./lib";

const lineItem = v.object({ product_id: v.string(), quantity: v.number(), price: v.optional(v.number()), unit: v.optional(v.string()) });
const qtyItem = v.object({ product_id: v.string(), quantity: v.number(), unit: v.optional(v.string()) });

async function scopedList(ctx: any, token: string, table: string) {
  const user = await require(ctx, token, ANY_ORG);
  const rows = isAgent(user)
    ? await ctx.db
        .query(table)
        .withIndex("by_distributor", (q: any) => q.eq("distributor_id", user.user_id))
        .filter((q: any) => q.eq(q.field("org_id"), user.org_id))
        .collect()
    : await ctx.db.query(table).withIndex("by_org", (q: any) => q.eq("org_id", user.org_id)).collect();
  rows.sort((a: any, b: any) => String(b.created_at).localeCompare(String(a.created_at)));
  return cleanAll(rows);
}

// ========================= Sales returns (goods back INTO distributor stock) =========================
export const listSales = query({
  args: { token: v.string() },
  handler: (ctx, { token }) => scopedList(ctx, token, "sales_returns"),
});

export const createSales = mutation({
  args: {
    token: v.string(),
    id: v.optional(v.string()),
    customer_id: v.string(),
    items: v.array(lineItem),
    reason: v.optional(v.string()),
    lat: v.optional(v.union(v.number(), v.null())),
    lng: v.optional(v.union(v.number(), v.null())),
    client_created_at: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, a) => {
    const user = await require(ctx, a.token, AGENT);
    const cust = await orgCustomer(ctx, user, a.customer_id);
    if (a.id) {
      const ex = await docOrgUnique(ctx, "sales_returns", a.id, user.org_id!);
      if (ex) return clean(ex);
    }
    const items: any[] = [];
    let total = 0;
    const { rate } = await orgMoney(ctx, user.org_id!);
    // Strict returns: only products this distributor actually sold to this customer, up to
    // (sold − already returned). Runs inside the mutation transaction, so concurrent or
    // replayed (offline) requests are serialized and can never exceed the sold quantity.
    if (!a.items.length || a.items.length > 100) throw new Error("أضف منتجاً واحداً على الأقل");
    const sold: Record<string, number> = {};
    for (const s of await ctx.db.query("sales").withIndex("by_customer", (q) => q.eq("customer_id", cust.id)).collect()) {
      if (s.org_id !== user.org_id || s.distributor_id !== user.user_id || (s as any).voided) continue;
      for (const it of (s.items ?? []) as any[]) sold[it.product_id] = (sold[it.product_id] ?? 0) + linePieces(it);
    }
    const returned: Record<string, number> = {};
    for (const r of await ctx.db.query("sales_returns").withIndex("by_customer", (q) => q.eq("customer_id", cust.id)).collect()) {
      if (r.org_id !== user.org_id || r.distributor_id !== user.user_id) continue;
      for (const it of (r.items ?? []) as any[]) returned[it.product_id] = (returned[it.product_id] ?? 0) + (it.pieces ?? linePieces(it));
    }
    const asked: Record<string, number> = {};
    for (const it of a.items) {
      if (!(it.quantity > 0) || it.quantity > 1e6 || Math.round(it.quantity * 1000) !== it.quantity * 1000) throw new Error("كمية غير صالحة");
    }
    for (const it of a.items) {
      const prod: any = await docOrgUnique(ctx, "products", it.product_id, user.org_id!);
      if (!prod) throw new Error("المنتج غير موجود");
      const u = unitQty(prod, it.unit, it.quantity);
      asked[prod.id] = (asked[prod.id] ?? 0) + u.pieces;
      const left = (sold[prod.id] ?? 0) - (returned[prod.id] ?? 0);
      if (!sold[prod.id]) throw new Error(`لا يمكن إرجاع "${prod.name}": لم تبعه لهذا العميل`);
      if (asked[prod.id] > left + 1e-9) throw new Error(`كمية الإرجاع لـ "${prod.name}" تتجاوز المباع (المتبقي القابل للإرجاع ${Math.max(0, round2(left))} قطعة)`);
      const piece = toBase(await priceFor(ctx, user.org_id!, cust, prod.id), prod.price_currency === "USD" ? "USD" : "SYP", rate);
      const price = u.unit === "PACKAGE" ? round2(piece * u.pieces_per_package) : piece; // per returned unit, SYP
      const line = round2(it.quantity * price);
      total += line;
      items.push({ product_id: prod.id, product_name: prod.name, ...u, price, unit_price: price, total: line });
      await invAdjust(ctx, user.org_id!, user.user_id, prod.id, prod.name, u.pieces);
      await logMovement(ctx, user.org_id!, prod.id, prod.name, "RETURN", u.pieces, user.name ?? null, "AGENT");
    }
    total = round2(total);
    await ctx.db.patch(cust._id, { balance: round2((cust.balance ?? 0) - total) });
    const doc = {
      id: a.id || newId(),
      ...geoFields(a),
      org_id: user.org_id!,
      return_no: await nextNo(ctx, user.org_id!, "ret", "RET"),
      customer_id: cust.id,
      customer_name: cust.name,
      distributor_id: user.user_id,
      distributor_name: user.name ?? null,
      items,
      total,
      reason: a.reason ?? "",
      created_at: nowIso(),
    };
    await ctx.db.insert("sales_returns", doc);
    return doc;
  },
});

// ========================= Warehouse returns (distributor -> warehouse, owner confirms) =========================
export const listWarehouse = query({
  args: { token: v.string() },
  handler: (ctx, { token }) => scopedList(ctx, token, "warehouse_returns"),
});

export const createWarehouse = mutation({
  args: { token: v.string(), id: v.optional(v.string()), items: v.array(qtyItem), notes: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const user = await require(ctx, a.token, AGENT);
    if (a.id) {
      const ex = await docOrgUnique(ctx, "warehouse_returns", a.id, user.org_id!);
      if (ex) return clean(ex);
    }
    if (!a.items.length) throw new Error("أضف صنفاً واحداً على الأقل");
    const items: any[] = [];
    for (const it of a.items) {
      const inv = await distInv(ctx, user.user_id, it.product_id);
      const prod = await docOrgUnique(ctx, "products", it.product_id, user.org_id!);
      const u = unitQty(prod, it.unit, it.quantity);
      if (!inv || (inv.quantity ?? 0) < u.pieces - 0.0001) throw new Error(`الكمية غير متوفرة لديك: ${inv?.product_name ?? ""}`);
      items.push({ product_id: it.product_id, product_name: inv.product_name, ...u });
    }
    for (const it of items) {
      await invAdjust(ctx, user.org_id!, user.user_id, it.product_id, it.product_name, -it.pieces);
      await logMovement(ctx, user.org_id!, it.product_id, it.product_name, "DIST_RETURN_OUT", -it.pieces, user.name ?? null, "AGENT");
    }
    const doc = {
      id: a.id || newId(),
      org_id: user.org_id!,
      return_no: await nextNo(ctx, user.org_id!, "wret", "WRT"),
      distributor_id: user.user_id,
      distributor_name: user.name ?? null,
      items,
      notes: a.notes ?? "",
      status: "PENDING",
      created_at: nowIso(),
    };
    await ctx.db.insert("warehouse_returns", doc);
    await notify(ctx, await orgOwnerIds(ctx, user.org_id!), "warehouse_return", "مرتجع موزع بانتظار الاستلام", `${user.name ?? ""} أرجع ${items.length} صنف إلى المستودع`);
    return doc;
  },
});

async function pendingWReturn(ctx: any, rid: string, org_id: string) {
  const r = await docOrgUnique(ctx, "warehouse_returns", rid, org_id);
  if (!r || r.status !== "PENDING") throw new Error("المرتجع غير موجود أو تمت معالجته");
  return r;
}

export const acceptWarehouse = mutation({
  args: { token: v.string(), id: v.string() },
  handler: async (ctx, { token, id }) => {
    const user = await require(ctx, token, OWNER);
    const r = await pendingWReturn(ctx, id, user.org_id!);
    for (const it of r.items) {
      const prod = await docOrgUnique(ctx, "products", it.product_id, user.org_id!);
      if (prod) await ctx.db.patch(prod._id, { stock: round2((prod.stock ?? 0) + linePieces(it)) });
      await logMovement(ctx, user.org_id!, it.product_id, it.product_name, "DIST_RETURN", linePieces(it), user.name ?? null, "WAREHOUSE");
    }
    await ctx.db.patch(r._id, { status: "ACCEPTED", handled_at: nowIso(), handled_by: user.name ?? null });
    await notify(ctx, [r.distributor_id], "warehouse_return_accepted", "تم استلام المرتجع", `تم استلام المرتجع ${r.return_no} في المستودع`);
    return clean(await ctx.db.get(r._id));
  },
});

export const rejectWarehouse = mutation({
  args: { token: v.string(), id: v.string(), reason: v.optional(v.string()) },
  handler: async (ctx, { token, id, reason }) => {
    const user = await require(ctx, token, OWNER);
    const r = await pendingWReturn(ctx, id, user.org_id!);
    for (const it of r.items) {
      await invAdjust(ctx, user.org_id!, r.distributor_id, it.product_id, it.product_name, linePieces(it));
      await logMovement(ctx, user.org_id!, it.product_id, it.product_name, "DIST_RETURN_REJECTED", linePieces(it), user.name ?? null, "AGENT");
    }
    await ctx.db.patch(r._id, { status: "REJECTED", reject_reason: reason ?? "", handled_at: nowIso(), handled_by: user.name ?? null });
    await notify(ctx, [r.distributor_id], "warehouse_return_rejected", "تم رفض المرتجع", `رُفض المرتجع ${r.return_no} وأعيدت الكميات إلى مخزونك${reason ? " · " + reason : ""}`);
    return clean(await ctx.db.get(r._id));
  },
});
