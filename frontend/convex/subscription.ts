// SaaS subscription layer on top of billing.ts: dynamic feature/resource catalog (developer-only),
// owner usage vs limits, upgrade quotes (proration), financial ledger and subscription lifecycle actions.
import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
import { DEV, assertNotDeleted, OWNER, audit, catalogOf, clean, cleanAll, isPro, notify, nowIso, orgById, orgLimits, orgUsage, prorate, periodPrice, pubOf, require } from "./lib";

// GET /api/billing/catalog — features + resources the developer defined (everyone signed in can read labels).
export const catalogGet = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    await require(ctx, token, ["OWNER", "ACCOUNTANT", "FIELD_AGENT", "DEVELOPER"]);
    return await catalogOf(ctx);
  },
});

const KEY = /^[a-z][a-z0-9_]{1,30}$/;
// PUT /api/dev/billing/catalog — developer adds/renames features and resources (keys are permanent).
export const devCatalogSave = mutation({
  args: { token: v.string(), features: v.array(v.object({ key: v.string(), label: v.string() })), resources: v.array(v.object({ key: v.string(), label: v.string() })) },
  handler: async (ctx, a) => {
    const user = await require(ctx, a.token, DEV);
    const before = await catalogOf(ctx);
    const norm = (list: { key: string; label: string }[], base: { key: string }[]) => {
      const out = list.map((x) => ({ key: x.key.trim(), label: x.label.trim().slice(0, 60) }));
      for (const x of out) if (!KEY.test(x.key) || !x.label) throw new Error(`مفتاح أو اسم غير صالح: ${x.key}`);
      for (const b of base) if (!out.some((x) => x.key === b.key)) throw new Error(`لا يمكن حذف العنصر ${b.key} (مستخدم في الخطط)`);
      return out.filter((x, i) => out.findIndex((y) => y.key === x.key) === i);
    };
    const data = { features: norm(a.features, before.features), resources: norm(a.resources, before.resources) };
    const ex: any = await ctx.db.query("app_settings").withIndex("by_key", (q) => q.eq("key", "billing_catalog")).unique();
    if (ex) await ctx.db.patch(ex._id, { data });
    else await ctx.db.insert("app_settings", { key: "billing_catalog", data });
    await audit(ctx, user, "catalog.update", { before, after: data });
    return data;
  },
});

// GET /api/subscription — owner: current plan, dates, status, usage vs limits, last payment request.
export const mine = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const user = await require(ctx, token, OWNER, { billing: true });
    const org: any = await orgById(ctx, user.org_id!);
    const limits = await orgLimits(ctx, org);
    const usage = await orgUsage(ctx, org.id);
    const cat = await catalogOf(ctx);
    const reqs = await ctx.db.query("upgrade_requests").withIndex("by_org", (q) => q.eq("org_id", org.id)).collect();
    reqs.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    const meters = cat.resources.map((r) => {
      const max = (limits as any)[r.key] ?? null;
      const used = (usage as any)[r.key] ?? null;
      return { key: r.key, label: r.label, used, max, pct: max && used != null ? Math.min(100, Math.round((used / max) * 100)) : null };
    });
    return {
      plan: org.plan, plan_id: org.plan_id ?? null, plan_name: org.plan_name ?? null, tier: isPro(org) ? org.plan_tier ?? (org.plan === "TRIAL" ? "PRO" : null) : "FREE",
      status: org.status === "FROZEN" ? "FROZEN" : isPro(org) ? "ACTIVE" : org.status === "SUSPENDED" ? "SUSPENDED" : org.plan === "LICENSE" ? "EXPIRED" : "FREE",
      started_at: org.started_at ?? org.created_at ?? null, expires_at: org.expires_at ?? null, grace_until: org.grace_until ?? null,
      modules: isPro(org) ? org.modules ?? null : [], meters,
      last_request: reqs[0] ? { ref_code: reqs[0].ref_code, status: reqs[0].status, plan_name: reqs[0].plan_name, note: reqs[0].review_note ?? "", created_at: reqs[0].created_at } : null,
    };
  },
});

// GET /api/subscription/quote?plan_id=&billing= — price, upgrade credit and amount due (same math as createRequest).
export const quote = query({
  args: { token: v.string(), plan_id: v.string(), billing: v.string() },
  handler: async (ctx, a) => {
    const user = await require(ctx, a.token, OWNER, { billing: true });
    const plan: any = pubOf(await ctx.db.query("plans").withIndex("by_biz_id", (q) => q.eq("id", a.plan_id)).unique());
    if (!plan || (plan.org_ids?.length && !plan.org_ids.includes(user.org_id))) throw new Error("الخطة غير متاحة");
    const period = periodPrice(plan, a.billing);
    if (!period) throw new Error("فترة الفوترة غير متاحة لهذه الخطة");
    const org: any = await orgById(ctx, user.org_id!);
    const credit = prorate(org, plan);
    const monthly = periodPrice(plan, "monthly")!;
    const yearlySaving = plan.yearly_price ? Math.max(0, Math.round((monthly.price * Math.max(1, Math.round(365 / (plan.days || 30))) - plan.yearly_price) * 100) / 100) : 0;
    return { price: period.price, days: period.days, credit, due: Math.max(0, Math.round((period.price - credit) * 100) / 100), currency: plan.currency, yearly_saving: yearlySaving };
  },
});

// GET /api/dev/billing/ledger — every approved payment and refund (financial log).
export const devLedger = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    await require(ctx, token, DEV);
    return cleanAll(await ctx.db.query("billing_ledger").order("desc").take(300));
  },
});

// GET /api/dev/subscriptions?status= — orgs with their subscription state.
export const devSubscriptions = query({
  args: { token: v.string(), status: v.optional(v.string()) },
  handler: async (ctx, { token, status }) => {
    await require(ctx, token, DEV);
    const orgs: any[] = await ctx.db.query("organizations").collect();
    const st = (o: any) => (o.status === "FROZEN" ? "FROZEN" : o.status === "SUSPENDED" ? "SUSPENDED" : isPro(o) ? "ACTIVE" : o.plan === "LICENSE" || o.plan === "TRIAL" ? "EXPIRED" : "FREE");
    return orgs
      .map((o) => ({ id: o.id, name: o.name, plan: o.plan, plan_name: o.plan_name ?? null, tier: o.plan_tier ?? null, state: st(o), expires_at: o.expires_at ?? null, started_at: o.started_at ?? null }))
      .filter((o) => !status || o.state === status)
      .sort((a, b) => String(a.expires_at ?? "").localeCompare(String(b.expires_at ?? "")));
  },
});

// POST /api/dev/subscriptions/:id/action { action: freeze|unfreeze|suspend|reactivate|extend, days?, note? }
export const devSubAction = mutation({
  args: { token: v.string(), id: v.string(), action: v.string(), days: v.optional(v.number()), note: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const user = await require(ctx, a.token, DEV);
    const org: any = await orgById(ctx, a.id);
    if (!org) throw new Error("المؤسسة غير موجودة");
    assertNotDeleted(org);
    const now = Date.now();
    let patch: any;
    switch (a.action) {
      case "freeze": {
        if (org.status === "FROZEN") throw new Error("الاشتراك مجمّد بالفعل");
        const left = org.expires_at ? Math.max(0, Date.parse(org.expires_at) - now) : 0;
        patch = { status: "FROZEN", frozen_remaining_ms: left, frozen_at: nowIso() };
        break;
      }
      case "unfreeze": {
        if (org.status !== "FROZEN") throw new Error("الاشتراك غير مجمّد");
        patch = { status: "ACTIVE", expires_at: new Date(now + (org.frozen_remaining_ms ?? 0)).toISOString(), frozen_remaining_ms: null, frozen_at: null };
        break;
      }
      case "suspend":
        patch = { status: "SUSPENDED" };
        break;
      case "reactivate":
        if (org.status === "FROZEN") throw new Error("ألغِ التجميد بدلاً من ذلك");
        patch = { status: "ACTIVE" };
        break;
      case "extend": {
        const d = Math.floor(a.days ?? 0);
        if (!(d >= 1 && d <= 3660)) throw new Error("المدة غير صالحة");
        const base = Math.max(Date.parse(org.expires_at ?? "") || now, now);
        patch = { expires_at: new Date(base + d * 86400000).toISOString(), plan: org.plan === "FREE" ? "LICENSE" : org.plan, status: org.status === "FROZEN" ? "FROZEN" : "ACTIVE" };
        if (org.status === "FROZEN") patch = { frozen_remaining_ms: (org.frozen_remaining_ms ?? 0) + d * 86400000 };
        break;
      }
      default:
        throw new Error("إجراء غير صالح");
    }
    await ctx.db.patch(org._id, patch);
    await audit(ctx, user, `subscription.${a.action}`, { org_id: org.id, note: a.note, before: { status: org.status, expires_at: org.expires_at }, after: patch });
    const msg: Record<string, string> = { freeze: "تم تجميد اشتراك مؤسستك", unfreeze: "تم إلغاء تجميد اشتراكك", suspend: "تم إيقاف اشتراك مؤسستك", reactivate: "تمت إعادة تفعيل اشتراكك", extend: "تم تمديد اشتراك مؤسستك" };
    await notify(ctx, [org.owner_id], "upgrade", msg[a.action], a.note ?? "");
    return clean(await ctx.db.get(org._id));
  },
});
