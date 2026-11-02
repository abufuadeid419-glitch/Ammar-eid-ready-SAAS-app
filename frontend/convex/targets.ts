import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
import { ANY_ORG, OWNER, isAgent, notify, nowIso, require, round2, sumBy } from "./lib";

function monthRange(month?: string) {
  const m = month || nowIso().slice(0, 7);
  const [y, mo] = m.split("-").map(Number);
  if (!y || !mo || mo < 1 || mo > 12) throw new Error("صيغة الشهر غير صحيحة");
  const pad = (n: number, l = 2) => String(n).padStart(l, "0");
  const start = `${pad(y, 4)}-${pad(mo)}-01`;
  const end = mo === 12 ? `${pad(y + 1, 4)}-01-01` : `${pad(y, 4)}-${pad(mo + 1)}-01`;
  const daysInMonth = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return { month: `${pad(y, 4)}-${pad(mo)}`, start, end, daysInMonth };
}

// Live monthly sales targets + achieved (net sales) per field agent. Agents see only themselves.
export const list = query({
  args: { token: v.string(), month: v.optional(v.string()) },
  handler: async (ctx, { token, month }) => {
    const user = await require(ctx, token, ANY_ORG);
    const org = user.org_id!;
    const r = monthRange(month);
    const inRange = (d: any) => String(d) >= r.start && String(d) < r.end;
    const users = await ctx.db.query("users").withIndex("by_org", (q) => q.eq("org_id", org)).collect();
    const agents = isAgent(user) ? [user] : users.filter((u) => u.employee_type === "FIELD_AGENT");
    const targets = await ctx.db.query("sales_targets").withIndex("by_org_month", (q) => q.eq("org_id", org).eq("month", r.month)).collect();
    const now = new Date();
    const curMonth = nowIso().slice(0, 7);
    const daysLeft = r.month === curMonth ? r.daysInMonth - now.getUTCDate() + 1 : r.month > curMonth ? r.daysInMonth : 0;
    const out: any[] = [];
    for (const a of agents) {
      const sales = (await ctx.db.query("sales").withIndex("by_distributor", (q) => q.eq("distributor_id", a.user_id)).collect()).filter((s) => s.org_id === org && !s.voided && inRange(s.created_at));
      const rets = (await ctx.db.query("sales_returns").withIndex("by_distributor", (q) => q.eq("distributor_id", a.user_id)).collect()).filter((x) => x.org_id === org && inRange(x.created_at));
      const achieved = round2(sumBy(sales, "total") - sumBy(rets, "total"));
      const target = targets.find((t) => t.distributor_id === a.user_id)?.amount ?? 0;
      const remaining = round2(Math.max(0, target - achieved));
      out.push({
        user_id: a.user_id,
        name: a.name ?? a.email,
        target,
        achieved,
        remaining,
        pct: target > 0 ? Math.round((achieved / target) * 100) : null,
        daily_needed: target > 0 && daysLeft > 0 ? round2(remaining / daysLeft) : 0,
      });
    }
    out.sort((x, y) => (y.pct ?? -1) - (x.pct ?? -1));
    return { month: r.month, days_left: daysLeft, days_in_month: r.daysInMonth, agents: out };
  },
});

// Owner sets (or clears with amount 0) a distributor's monthly target.
export const set = mutation({
  args: { token: v.string(), distributor_id: v.string(), month: v.optional(v.string()), amount: v.number() },
  handler: async (ctx, { token, distributor_id, month, amount }) => {
    const user = await require(ctx, token, OWNER);
    const org = user.org_id!;
    if (!(amount >= 0)) throw new Error("قيمة الهدف غير صالحة");
    const agent = await ctx.db.query("users").withIndex("by_user_id", (q) => q.eq("user_id", distributor_id)).unique();
    if (!agent || agent.org_id !== org || agent.employee_type !== "FIELD_AGENT") throw new Error("الموزع غير موجود");
    const r = monthRange(month);
    const ex = (await ctx.db.query("sales_targets").withIndex("by_org_month", (q) => q.eq("org_id", org).eq("month", r.month)).collect()).find((t) => t.distributor_id === distributor_id);
    if (amount === 0) {
      if (ex) await ctx.db.delete(ex._id);
      return { ok: true, amount: 0 };
    }
    if (ex) await ctx.db.patch(ex._id, { amount: round2(amount), updated_at: nowIso() });
    else await ctx.db.insert("sales_targets", { org_id: org, distributor_id, month: r.month, amount: round2(amount), created_at: nowIso(), updated_at: nowIso() });
    await notify(ctx, [distributor_id], "target", "هدف مبيعات جديد", `هدفك لشهر ${r.month}: ${round2(amount)}`);
    return { ok: true, amount: round2(amount) };
  },
});
