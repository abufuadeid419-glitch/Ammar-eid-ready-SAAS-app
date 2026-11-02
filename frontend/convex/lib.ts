import { QueryCtx, MutationCtx } from "./_generated/server";

// ---- id / time helpers (mirror server.py new_id / iso / gen_code) ----
export const nowIso = () => new Date().toISOString();
// A paid licence keeps working until the end of its grace period (grace_until), if one was set.
export const isExpired = (o: any) => {
  const end = o?.grace_until ?? o?.expires_at;
  return !!end && Date.parse(end) < Date.now();
};
// Pro = paid licence or the 14-day free Pro trial, while not expired.
export const isPro = (o: any) => !!o && o.status === "ACTIVE" && !isExpired(o) && ["TRIAL", "LICENSE"].includes(o.plan);
// Paid-plan feature modules the developer can switch on/off per plan (or per company).
export const MODULES = ["reports", "targets", "routes", "tracking", "daily_sms", "debt_sms"];
export const TIERS = ["PRO", "VIP"];
export const PLAN_TIERS = ["FREE", "PRO", "VIP"];

// Published (owner-visible) snapshot of a plan. Legacy plans (no status) count as published when active.
export const PLAN_FIELDS = [
  "name", "description", "tier", "price", "yearly_price", "promo_price", "promo_until", "currency", "days", "trial_days",
  "grace_days", "max_employees", "max_distributors", "max_customers", "modules", "features", "active", "recommended", "sort_order",
];
export const snapshotPlan = (p: any) => Object.fromEntries(PLAN_FIELDS.map((k) => [k, p[k] ?? null]));
export const pubOf = (p: any) => {
  if (!p || p.status === "archived") return null;
  const s = p.published ?? (p.status ? null : snapshotPlan(p));
  return s && s.active !== false ? { id: p.id, ...s, version: p.version ?? 1 } : null;
};
// Current price for a billing period of a published plan (server-side only; never trust the client).
export const periodPrice = (p: any, billing: string) => {
  if (billing === "yearly") return p.yearly_price ? { price: p.yearly_price, days: 365 } : null;
  const promo = p.promo_price != null && (!p.promo_until || Date.parse(p.promo_until) > Date.now());
  return { price: promo ? p.promo_price : p.price ?? 0, days: p.days ?? 30 };
};

// Effective resource limits: the org's paid licence values, otherwise the published Free plan.
export async function orgLimits(ctx: QueryCtx, org: any) {
  if (isPro(org)) return { employees: org.max_employees ?? 0, distributors: org.max_distributors ?? null, customers: org.max_customers ?? null };
  const free = (await ctx.db.query("plans").collect()).map(pubOf).find((p: any) => p?.tier === "FREE");
  return { employees: free?.max_employees ?? 1, distributors: free?.max_distributors ?? null, customers: free?.max_customers ?? null };
}

// Append-only audit trail (no receipt contents / secrets).
export async function audit(ctx: MutationCtx, actor: any, action: string, d: { org_id?: string; target?: string; before?: any; after?: any; note?: string } = {}) {
  await ctx.db.insert("audit_logs", { actor_id: actor?.user_id, actor_role: actor?.role, action, ...d, created_at: nowIso() });
}
// Trial / legacy licences without a module list get every feature.
export const hasFeature = (o: any, key: string) => isPro(o) && (!Array.isArray(o.modules) || o.modules.includes(key));
export const cleanModules = (m: any) => {
  if (m == null) return undefined;
  if (!Array.isArray(m) || m.some((k) => !MODULES.includes(k))) throw new Error("ميزات غير صالحة");
  return [...new Set(m as string[])];
};
export const newId = () => (globalThis.crypto as Crypto).randomUUID().replace(/-/g, "");
export const genCode = (prefix = "") => {
  const seg = () => Math.random().toString(16).slice(2, 6).toUpperCase().padStart(4, "0");
  return prefix + [seg(), seg(), seg()].join("-");
};

// Strip Convex system fields so results match the old Mongo/JSON shape the app expects.
export function clean<T extends Record<string, any>>(doc: T | null): any {
  if (!doc) return doc;
  const { _id, _creationTime, ...rest } = doc as any;
  return rest;
}
export const cleanAll = (docs: any[]) => docs.map(clean);

// ---- auth (mirror server.py get_user / require) ----
export async function getUser(ctx: QueryCtx, token?: string) {
  if (!token) throw new Error("غير مصرح");
  const sess = await ctx.db
    .query("user_sessions")
    .withIndex("by_token", (q) => q.eq("session_token", token))
    .unique();
  if (!sess) throw new Error("الجلسة غير صالحة");
  const exp = sess.expires_at;
  const expMs = typeof exp === "number" ? exp : exp ? Date.parse(exp) : 0;
  if (expMs && expMs < Date.now()) throw new Error("انتهت الجلسة");
  const user = await ctx.db
    .query("users")
    .withIndex("by_user_id", (q) => q.eq("user_id", sess.user_id))
    .unique();
  if (!user) throw new Error("المستخدم غير موجود");
  return user;
}

export function roleKey(user: any): string | null {
  return user.role === "EMPLOYEE" ? user.employee_type ?? null : user.role ?? null;
}

export async function orgById(ctx: QueryCtx, org_id?: string | null) {
  if (!org_id) return null;
  return await ctx.db
    .query("organizations")
    .withIndex("by_biz_id", (q) => q.eq("id", org_id))
    .unique();
}

// Role gate equivalent to server.py require(*roles). Returns the user or throws.
export async function require(ctx: QueryCtx, token: string | undefined, roles: string[]) {
  const user = await getUser(ctx, token);
  const key = roleKey(user);
  if (!key || !roles.includes(key)) throw new Error("ليس لديك صلاحية");
  if (key !== "DEVELOPER") {
    const org = await orgById(ctx, user.org_id);
    if (!org || org.status !== "ACTIVE") throw new Error("اشتراك المؤسسة غير فعال");
    // Expired trial = Free plan (keeps working, Pro features locked); expired paid licence blocks.
    if (org.plan !== "TRIAL" && isExpired(org)) throw new Error("انتهى اشتراك المؤسسة");
  }
  return user;
}

export const OWNER = ["OWNER"];
export const STAFF = ["OWNER", "ACCOUNTANT"];
export const AGENT = ["FIELD_AGENT"];
export const ANY_ORG = ["OWNER", "ACCOUNTANT", "FIELD_AGENT"];
export const DEV = ["DEVELOPER"];

export const isAgent = (user: any) => user.employee_type === "FIELD_AGENT";

// ---- counters (mirror next_no) ----
export async function nextNo(ctx: MutationCtx, org_id: string, kind: string, prefix: string) {
  const existing = await ctx.db
    .query("counters")
    .withIndex("by_org_kind", (q) => q.eq("org_id", org_id).eq("kind", kind))
    .unique();
  const n = (existing?.n ?? 0) + 1;
  if (existing) await ctx.db.patch(existing._id, { n });
  else await ctx.db.insert("counters", { org_id, kind, n });
  return `${prefix}-${String(n).padStart(5, "0")}`;
}

// ---- stock movement log (mirror log_movement) ----
export async function logMovement(
  ctx: MutationCtx,
  org_id: string,
  product_id: string,
  product_name: string,
  type: string,
  qty: number,
  byName: string | null,
  byRole = "OWNER",
) {
  await ctx.db.insert("stock_movements", {
    org_id,
    product_id,
    product_name,
    type,
    qty,
    by: byName,
    by_role: byRole,
    at: nowIso(),
  });
}

// ---- lookups by business string id ----
export async function docById(ctx: QueryCtx, table: any, id: string) {
  return await ctx.db.query(table).withIndex("by_biz_id", (q: any) => q.eq("id", id)).unique();
}

// Document of a table scoped to the user's org (mirror find_one({id, org_id})).
export async function docOrgUnique(ctx: QueryCtx, table: any, id: string, org_id: string) {
  return await ctx.db
    .query(table)
    .withIndex("by_biz_id", (q: any) => q.eq("id", id))
    .filter((q: any) => q.eq(q.field("org_id"), org_id))
    .unique();
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

// ---- currency helpers (base = org.currency, foreign = "USD" at org.exchange_rate) ----
// exchange_rate = how many base (SYP) units per 1 USD.
export async function orgMoney(ctx: QueryCtx, org_id: string) {
  const org: any = await orgById(ctx, org_id);
  return { rate: Number(org?.exchange_rate ?? 0), currency: org?.currency ?? "ل.س", alt_currency: org?.alt_currency ?? "" };
}
// Convert an amount priced in `cur` ("USD" | anything-else) into base SYP.
export const toBase = (amount: number, cur: string | undefined | null, rate: number) =>
  cur === "USD" && rate > 0 ? round2(amount * rate) : round2(amount);

// ---- geo fields (mirror server.py geo(body)) ----
export const geoFields = (a: any) => ({
  lat: a.lat ?? null,
  lng: a.lng ?? null,
  client_created_at: a.client_created_at ?? null,
});

// ---- customer access (mirror org_customer): agents only reach their own ----
export async function orgCustomer(ctx: QueryCtx, user: any, cid: string) {
  const c = await docOrgUnique(ctx, "customers", cid, user.org_id);
  if (!c || (isAgent(user) && c.distributor_id !== user.user_id)) throw new Error("العميل غير موجود");
  return c;
}

// ---- price for a customer (mirror price_for): customer-type price list then product price ----
export async function priceFor(ctx: QueryCtx, org_id: string, cust: any, product_id: string): Promise<number> {
  if (cust?.type_id) {
    const t = await docOrgUnique(ctx, "customer_types", cust.type_id, org_id);
    const p = (t as any)?.prices?.[product_id];
    if (p !== undefined && p !== null) return Number(p);
  }
  const prod = await docOrgUnique(ctx, "products", product_id, org_id);
  return prod ? Number((prod as any).sale_price) : 0;
}

// ---- distributor inventory line for (distributor, product) ----
export async function distInv(ctx: QueryCtx, distributor_id: string, product_id: string) {
  return await ctx.db
    .query("distributor_inventory")
    .withIndex("by_dist_product", (q) => q.eq("distributor_id", distributor_id).eq("product_id", product_id))
    .unique();
}

export const sumBy = (rows: any[], field: string) => round2(rows.reduce((n, r) => n + (r[field] || 0), 0));

// ---- distributor inventory adjust (mirror $inc quantity with upsert) ----
export async function invAdjust(
  ctx: MutationCtx,
  org_id: string,
  distributor_id: string,
  product_id: string,
  product_name: string,
  inc: number,
) {
  const row = await distInv(ctx, distributor_id, product_id);
  if (row) await ctx.db.patch(row._id, { quantity: round2((row.quantity ?? 0) + inc), org_id, product_name });
  else await ctx.db.insert("distributor_inventory", { org_id, distributor_id, product_id, product_name, quantity: round2(inc) });
}

// ---- notifications (mirror notify) ----
export async function notify(ctx: MutationCtx, userIds: (string | null | undefined)[], ntype: string, title: string, body: string) {
  for (const u of userIds) {
    if (u) await ctx.db.insert("notifications", { id: newId(), user_id: u, type: ntype, title, body, read: false, created_at: nowIso() });
  }
}

export async function orgOwnerIds(ctx: QueryCtx, org_id: string) {
  const org = await orgById(ctx, org_id);
  return org?.owner_id ? [org.owner_id] : [];
}

// ---- low-stock owner alerts (mirror check_low_stock) ----
export async function checkLowStock(ctx: MutationCtx, org_id: string, productIds: string[]) {
  for (const pid of productIds) {
    const p = await docOrgUnique(ctx, "products", pid, org_id);
    if (p && (p.stock ?? 0) <= (p.min_stock ?? 0)) {
      const out = (p.stock ?? 0) <= 0;
      await notify(
        ctx,
        await orgOwnerIds(ctx, org_id),
        out ? "out_of_stock" : "low_stock",
        out ? "نفاد المخزون" : "مخزون منخفض",
        `${p.name}: المتبقي ${p.stock ?? 0} ${p.unit ?? ""}`,
      );
    }
  }
}

// ---- units: every document line can be entered per piece or per package (stock is always pieces) ----
export function unitQty(prod: any, unit: string | undefined | null, quantity: number) {
  const ppp = Math.max(1, Math.round(prod?.pieces_per_package ?? 1));
  const isPackage = unit === "PACKAGE" && ppp > 1;
  return {
    unit: isPackage ? "PACKAGE" : "PIECE",
    unit_label: isPackage ? prod?.package_unit || "كرتونة" : prod?.unit || "قطعة",
    quantity: round2(quantity),
    pieces_per_package: ppp,
    pieces: round2(quantity * (isPackage ? ppp : 1)),
  };
}
export const linePieces = (it: any) => Number(it?.pieces ?? it?.quantity ?? 0);

// ---- inventory pricing policy when purchase cost changes: FIFO layers or weighted average ----
async function onHand(ctx: MutationCtx, prod: any) {
  const inv = await ctx.db.query("distributor_inventory").withIndex("by_org", (q: any) => q.eq("org_id", prod.org_id)).collect();
  return round2((prod.stock ?? 0) + inv.filter((i: any) => i.product_id === prod.id).reduce((s: number, i: any) => s + Math.max(0, i.quantity ?? 0), 0));
}

async function logPrice(ctx: MutationCtx, prod: any, oldPrice: number, newPrice: number, by: string | null) {
  if (Math.abs(oldPrice - newPrice) < 0.0001) return;
  await ctx.db.insert("price_history", { org_id: prod.org_id, product_id: prod.id, product_name: prod.name, old_price: oldPrice, new_price: newPrice, by, at: nowIso() });
  // Price change alert to every distributor of the organization.
  const agents = (await ctx.db.query("users").withIndex("by_org", (q: any) => q.eq("org_id", prod.org_id)).collect()).filter((u: any) => u.employee_type === "FIELD_AGENT");
  const cur = prod.price_currency === "USD" ? "$" : "";
  const dir = newPrice > oldPrice ? "ارتفع" : "انخفض";
  await notify(ctx, agents.map((u: any) => u.user_id), "price_change", `تغيّر سعر ${prod.name}`, `${dir} سعر البيع من ${round2(oldPrice)}${cur} إلى ${round2(newPrice)}${cur} للقطعة`);
}

// Returns the product patch for a purchase of `pieces` at `pieceCost` (both in the product's currency).
// Throws PRICING_METHOD_REQUIRED when the cost changes, old goods are on hand and the owner hasn't chosen a policy.
export async function purchaseCostPatch(ctx: MutationCtx, user: any, prod: any, pieces: number, pieceCost: number) {
  const org: any = await orgById(ctx, prod.org_id);
  const method = org?.pricing_method as "FIFO" | "WAVG" | "LATEST" | undefined;
  const oldCost = prod.cost_price ?? 0;
  const oldPrice = prod.sale_price ?? 0;
  const ppp = Math.max(1, Math.round(prod.pieces_per_package ?? 1));
  const held = await onHand(ctx, prod);
  const changed = Math.abs(pieceCost - oldCost) > 0.0001;
  if (changed && held > 0 && !method) throw new Error("PRICING_METHOD_REQUIRED");
  // Keep the same markup for the new goods.
  const scaled = method && changed && oldCost > 0 ? round2((oldPrice * pieceCost) / oldCost) : oldPrice;
  const patch: any = { cost_price: round2(pieceCost) };
  if (method === "LATEST") {
    // New cost and its price apply to ALL goods on hand of this product.
    Object.assign(patch, { cost_price: round2(pieceCost), sale_price: scaled, package_price: round2(scaled * ppp), cost_layers: [] });
  } else if (method === "WAVG" && held > 0) {
    const avg = round2((held * oldCost + pieces * pieceCost) / (held + pieces));
    const price = oldCost > 0 ? round2((oldPrice * avg) / oldCost) : oldPrice;
    Object.assign(patch, { cost_price: avg, sale_price: price, package_price: round2(price * ppp), cost_layers: [] });
  } else if (method === "FIFO") {
    let layers: any[] = Array.isArray(prod.cost_layers) ? prod.cost_layers.filter((l: any) => l.qty > 0) : [];
    if (Math.abs(layers.reduce((s, l) => s + l.qty, 0) - held) > 0.001) layers = held > 0 ? [{ qty: held, cost: oldCost, price: oldPrice, at: prod.created_at ?? nowIso() }] : [];
    layers.push({ qty: round2(pieces), cost: round2(pieceCost), price: scaled, at: nowIso() });
    const front = layers[0];
    Object.assign(patch, { cost_layers: layers, cost_price: front.cost, sale_price: front.price, package_price: round2(front.price * ppp) });
  } else if (method && held <= 0) {
    Object.assign(patch, { sale_price: scaled, package_price: round2(scaled * ppp) });
  }
  if (patch.sale_price !== undefined) await logPrice(ctx, prod, oldPrice, patch.sale_price, user.name ?? null);
  return patch;
}

// FIFO: goods leaving stock (sales / purchase returns) consume the oldest layer first; when it runs out
// the product switches to the next layer's cost and sale price.
export async function consumeFifo(ctx: MutationCtx, org_id: string, product_id: string, pieces: number, by: string | null) {
  const prod: any = await docOrgUnique(ctx, "products", product_id, org_id);
  if (!prod || !Array.isArray(prod.cost_layers) || !prod.cost_layers.length) return;
  const org: any = await orgById(ctx, org_id);
  if (org?.pricing_method !== "FIFO") return;
  let left = pieces;
  const layers = prod.cost_layers.map((l: any) => ({ ...l }));
  while (left > 0.0001 && layers.length) {
    const take = Math.min(layers[0].qty, left);
    layers[0].qty = round2(layers[0].qty - take);
    left -= take;
    if (layers[0].qty <= 0.0001) layers.shift();
  }
  const patch: any = { cost_layers: layers };
  if (layers.length) {
    const ppp = Math.max(1, Math.round(prod.pieces_per_package ?? 1));
    Object.assign(patch, { cost_price: layers[0].cost, sale_price: layers[0].price, package_price: round2(layers[0].price * ppp) });
    await logPrice(ctx, prod, prod.sale_price ?? 0, layers[0].price, by);
  }
  await ctx.db.patch(prod._id, patch);
}
