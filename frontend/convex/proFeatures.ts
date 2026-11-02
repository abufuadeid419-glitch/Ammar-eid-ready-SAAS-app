import { v } from "convex/values";

import { internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { sendSms } from "./edge";
import { OWNER, hasFeature, isExpired, notify, nowIso, orgById, require } from "./lib";

const DAY = 86400000;
const PERIODS = [7, 14, 30];
const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

// Customer phone -> E.164 using the company's country code for local numbers.
function toIntl(p: string | undefined, cc?: string) {
  const raw = (p ?? "").trim();
  let d = raw.replace(/[^\d]/g, "");
  if (!d) return null;
  if (!raw.startsWith("+")) {
    if (d.startsWith("00")) d = d.slice(2);
    else if (cc && d.startsWith("0")) d = cc + d.replace(/^0+/, "");
    else if (cc && d.length <= 10 && !d.startsWith(cc)) d = cc + d;
  }
  return /^[1-9]\d{7,14}$/.test(d) ? `+${d}` : null;
}

const debtText = (org: any, c: any) =>
  `${org.name ?? "النظام الذكي"}: السلام عليكم ${c.name ?? ""}، نذكركم بأن رصيدكم المستحق ${fmt(c.balance)} ${org.currency || "ل.س"}. ` +
  `نرجو التسديد في أقرب وقت.${org.phone ? ` للاستفسار: ${org.phone}` : ""}`;

async function dueCustomers(ctx: any, org: any) {
  const days = org.debt_sms_days ?? 14;
  const rows = await ctx.db.query("customers").withIndex("by_org", (q: any) => q.eq("org_id", org.id)).collect();
  return rows.filter(
    (c: any) => (Number(c.balance) || 0) > 0 && !c.deleted && toIntl(c.phone, org.phone_country_code) &&
      (!c.last_sms_reminder_at || Date.now() - Date.parse(c.last_sms_reminder_at) >= days * DAY),
  );
}

// GET /api/org/debt-sms
export const debtSettings = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const user = await require(ctx, token, OWNER);
    const org: any = await orgById(ctx, user.org_id!);
    const due = await dueCustomers(ctx, org);
    return {
      enabled: !!org.debt_sms_enabled,
      days: org.debt_sms_days ?? 14,
      eligible: due.length,
      sample: debtText(org, due[0] ?? { name: "اسم العميل", balance: 150000 }),
    };
  },
});

// PUT /api/org/debt-sms
export const setDebtSettings = mutation({
  args: { token: v.string(), enabled: v.boolean(), days: v.number() },
  handler: async (ctx, { token, enabled, days }) => {
    const user = await require(ctx, token, OWNER);
    const org: any = await orgById(ctx, user.org_id!);
    if (!PERIODS.includes(days)) throw new Error("فترة غير صالحة");
    if (enabled && !hasFeature(org, "debt_sms")) throw new Error("تذكير الديون عبر SMS غير متاح في خطتك الحالية");
    await ctx.db.patch(org._id, { debt_sms_enabled: enabled, debt_sms_days: days });
    return { enabled, days };
  },
});

export const collectDebtReminders = internalQuery({
  args: {},
  handler: async (ctx) => {
    const orgs = (await ctx.db.query("organizations").collect()).filter((o: any) => o.debt_sms_enabled && hasFeature(o, "debt_sms"));
    const out: { id: string; phone: string; text: string }[] = [];
    for (const o of orgs) {
      for (const c of await dueCustomers(ctx, o)) out.push({ id: c.id, phone: toIntl(c.phone, o.phone_country_code)!, text: debtText(o, c) });
    }
    return out;
  },
});

export const markReminded = internalMutation({
  args: { ids: v.array(v.string()) },
  handler: async (ctx, { ids }) => {
    for (const id of ids) {
      const c = await ctx.db.query("customers").withIndex("by_biz_id", (q: any) => q.eq("id", id)).unique();
      if (c) await ctx.db.patch(c._id, { last_sms_reminder_at: nowIso() } as any);
    }
  },
});

// Cron target: one SMS per debtor per chosen period.
export const sendDebtReminders = internalAction({
  args: {},
  handler: async (ctx): Promise<{ total: number; sent: number }> => {
    const list: { id: string; phone: string; text: string }[] = await ctx.runQuery(internal.proFeatures.collectDebtReminders, {});
    const ok: string[] = [];
    for (const r of list) {
      const res = await sendSms(r.phone, r.text);
      if (res.ok) ok.push(r.id);
      else console.error("debt sms failed", r.phone, res.status);
    }
    if (ok.length) await ctx.runMutation(internal.proFeatures.markReminded, { ids: ok });
    return { total: list.length, sent: ok.length };
  },
});

// Trial reminders: in-app notification + SMS to the owner at 3 days, 1 day and on expiry (once each).
export const trialReminderBatch = internalMutation({
  args: {},
  handler: async (ctx) => {
    const out: { phone: string; text: string }[] = [];
    for (const o of (await ctx.db.query("organizations").collect()) as any[]) {
      if (o.plan !== "TRIAL" || o.status !== "ACTIVE" || !o.expires_at) continue;
      const left = Math.ceil((Date.parse(o.expires_at) - Date.now()) / DAY);
      const key = isExpired(o) ? "expired" : left <= 1 ? "1" : left <= 3 ? "3" : null;
      const done: string[] = o.trial_reminders ?? [];
      if (!key || done.includes(key)) continue;
      const text =
        key === "expired"
          ? "انتهت تجربة Pro المجانية. بياناتك محفوظة — اشترك الآن من صفحة الخطط لإعادة فتح التقارير المتقدمة وتذكير الديون وتتبع الموزعين."
          : `تبقى ${key === "1" ? "يوم واحد" : "3 أيام"} على انتهاء تجربة Pro المجانية. اشترك الآن لتبقى جميع الميزات مفتوحة.`;
      await notify(ctx, [o.owner_id], "TRIAL", "تجربة Pro", text);
      await ctx.db.patch(o._id, { trial_reminders: [...done, key] });
      const owner = await ctx.db.query("users").withIndex("by_user_id", (q: any) => q.eq("user_id", o.owner_id)).first();
      if (owner?.phone && /^\+[1-9]\d{7,14}$/.test(owner.phone)) out.push({ phone: owner.phone, text: `النظام الذكي: ${text}` });
    }
    return out;
  },
});

export const sendTrialReminders = internalAction({
  args: {},
  handler: async (ctx): Promise<number> => {
    const list: { phone: string; text: string }[] = await ctx.runMutation(internal.proFeatures.trialReminderBatch, {});
    for (const s of list) await sendSms(s.phone, s.text);
    return list.length;
  },
});
