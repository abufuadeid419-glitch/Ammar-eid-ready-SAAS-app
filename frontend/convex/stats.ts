import { v } from "convex/values";

import { query } from "./_generated/server";
import { ANY_ORG, STAFF, cleanAll, isAgent, nowIso, require, round2, sumBy } from "./lib";

// GET /api/stats/overview  (ANY_ORG) — owner/accountant dashboard; agents see their own slice.
export const overview = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const user = await require(ctx, token, ANY_ORG);
    const org = user.org_id!;
    const agent = isAgent(user);

    const sales = agent
      ? await ctx.db
          .query("sales")
          .withIndex("by_distributor", (q) => q.eq("distributor_id", user.user_id))
          .filter((q) => q.eq(q.field("org_id"), org))
          .collect()
      : await ctx.db.query("sales").withIndex("by_org", (q) => q.eq("org_id", org)).collect();

    const colls = agent
      ? await ctx.db
          .query("collections")
          .withIndex("by_collector", (q) => q.eq("collector_id", user.user_id))
          .filter((q) => q.eq(q.field("org_id"), org))
          .collect()
      : await ctx.db.query("collections").withIndex("by_org", (q) => q.eq("org_id", org)).collect();

    const returns = agent
      ? await ctx.db
          .query("sales_returns")
          .withIndex("by_distributor", (q) => q.eq("distributor_id", user.user_id))
          .filter((q) => q.eq(q.field("org_id"), org))
          .collect()
      : await ctx.db.query("sales_returns").withIndex("by_org", (q) => q.eq("org_id", org)).collect();

    const purchases = await ctx.db.query("purchases").withIndex("by_org", (q) => q.eq("org_id", org)).collect();
    const customers = await ctx.db.query("customers").withIndex("by_org", (q) => q.eq("org_id", org)).collect();
    const products = await ctx.db.query("products").withIndex("by_org", (q) => q.eq("org_id", org)).collect();

    const today = nowIso().slice(0, 10);
    const salesToday = sales.filter((s) => String(s.created_at) >= today);
    const sales_total = sumBy(sales, "total");

    let gross_profit: number | null = null;
    if (user.role === "OWNER") {
      const costs: Record<string, number> = {};
      for (const p of products) costs[p.id] = p.cost_price || 0;
      let cost = 0;
      for (const s of sales) {
        if (s.voided) continue;
        for (const i of s.items || []) cost += (costs[i.product_id] || 0) * i.quantity;
      }
      gross_profit = round2(sales_total - cost);
    }

    return {
      sales_total,
      sales_count: sales.length,
      today_sales: sumBy(salesToday, "total"),
      today_count: salesToday.length,
      collections_total: sumBy(colls, "amount"),
      returns_total: sumBy(returns, "total"),
      purchases_total: sumBy(purchases, "total"),
      debts_total: round2(customers.filter((c) => (c.balance || 0) > 0).reduce((n, c) => n + c.balance, 0)),
      customers: customers.length,
      products: products.length,
      low_stock: cleanAll(products.filter((p) => (p.stock || 0) <= (p.min_stock || 0)).slice(0, 10)),
      stock_value: round2(products.reduce((n, p) => n + (p.stock || 0) * (p.cost_price || 0), 0)),
      gross_profit,
      recent_sales: cleanAll([...sales].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 5)),
    };
  },
});

async function orgAgents(ctx: any, org: string) {
  const users = await ctx.db.query("users").withIndex("by_org", (q: any) => q.eq("org_id", org)).collect();
  return users.filter((u: any) => u.employee_type === "FIELD_AGENT");
}

// GET /api/stats/agents  (STAFF)
export const agents = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const user = await require(ctx, token, STAFF);
    const org = user.org_id!;
    const out: any[] = [];
    for (const a of await orgAgents(ctx, org)) {
      const sales = await ctx.db
        .query("sales")
        .withIndex("by_distributor", (q) => q.eq("distributor_id", a.user_id))
        .filter((q) => q.eq(q.field("org_id"), org))
        .collect();
      const colls = await ctx.db
        .query("collections")
        .withIndex("by_collector", (q) => q.eq("collector_id", a.user_id))
        .filter((q) => q.eq(q.field("org_id"), org))
        .collect();
      out.push({
        user_id: a.user_id,
        name: a.name ?? null,
        email: a.email,
        sales_total: sumBy(sales, "total"),
        sales_count: sales.length,
        collections_total: sumBy(colls, "amount"),
      });
    }
    return out;
  },
});

// GET /api/stats/leaderboard  (STAFF) — monthly distributor ranking (month = YYYY-MM).
export const leaderboard = query({
  args: { token: v.string(), month: v.optional(v.string()) },
  handler: async (ctx, { token, month }) => {
    const user = await require(ctx, token, STAFF);
    const org = user.org_id!;
    const m = month || nowIso().slice(0, 7);
    const [y, mo] = m.split("-").map(Number);
    if (!y || !mo || mo < 1 || mo > 12) throw new Error("صيغة الشهر غير صحيحة");
    const start = `${String(y).padStart(4, "0")}-${String(mo).padStart(2, "0")}-01`;
    const ny = mo === 12 ? y + 1 : y;
    const nmo = mo === 12 ? 1 : mo + 1;
    const end = `${String(ny).padStart(4, "0")}-${String(nmo).padStart(2, "0")}-01`;
    const inRange = (d: any) => {
      const s = String(d);
      return s >= start && s < end;
    };

    const out: any[] = [];
    for (const a of await orgAgents(ctx, org)) {
      const uid = a.user_id;
      const sales = (
        await ctx.db
          .query("sales")
          .withIndex("by_distributor", (q) => q.eq("distributor_id", uid))
          .filter((q) => q.eq(q.field("org_id"), org))
          .collect()
      ).filter((s) => !s.voided && inRange(s.created_at));
      const colls = (
        await ctx.db
          .query("collections")
          .withIndex("by_collector", (q) => q.eq("collector_id", uid))
          .filter((q) => q.eq(q.field("org_id"), org))
          .collect()
      ).filter((c) => inRange(c.created_at));
      const rets = (
        await ctx.db
          .query("sales_returns")
          .withIndex("by_distributor", (q) => q.eq("distributor_id", uid))
          .filter((q) => q.eq(q.field("org_id"), org))
          .collect()
      ).filter((r) => inRange(r.created_at));
      out.push({
        user_id: uid,
        name: a.name ?? null,
        email: a.email,
        sales_total: sumBy(sales, "total"),
        sales_count: sales.length,
        customers_count: new Set(sales.map((s) => s.customer_id)).size,
        collections_total: sumBy(colls, "amount"),
        returns_total: sumBy(rets, "total"),
      });
    }
    out.sort((x, y2) => y2.sales_total - x.sales_total || y2.collections_total - x.collections_total);
    out.forEach((x, i) => (x.rank = i + 1));
    return { month: `${String(y).padStart(4, "0")}-${String(mo).padStart(2, "0")}`, agents: out };
  },
});
