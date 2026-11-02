import { v } from "convex/values";

import { action, internalAction, internalQuery, mutation, query } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { sendSms, smsFailureMessage } from "./edge";
import { OWNER, hasFeature, orgById, require } from "./lib";

// Evening SMS to each org owner: today's sales, collections and new debts.
const TZ_OFFSET_MS = 3 * 3600 * 1000; // Syria (UTC+3)
const PHONE_RE = /^\+[1-9]\d{7,14}$/;

function dayStartIso(now = Date.now()) {
  const local = new Date(now + TZ_OFFSET_MS);
  local.setUTCHours(0, 0, 0, 0);
  return new Date(local.getTime() - TZ_OFFSET_MS).toISOString();
}

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

async function summarize(ctx: any, org: any) {
  const since = dayStartIso();
  const sales = (await ctx.db.query("sales").withIndex("by_org", (q: any) => q.eq("org_id", org.id)).collect())
    .filter((s: any) => !s.voided && String(s.created_at ?? "") >= since);
  const cols = (await ctx.db.query("collections").withIndex("by_org", (q: any) => q.eq("org_id", org.id)).collect())
    .filter((c: any) => String(c.created_at ?? "") >= since);
  const sum = (rows: any[], k: string) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);
  const cur = org.currency || "ل.س";
  const owner = org.owner_id ? await ctx.db.query("users").withIndex("by_user_id", (q: any) => q.eq("user_id", org.owner_id)).first() : null;
  const phone = [owner?.phone, owner?.email].find((p) => typeof p === "string" && PHONE_RE.test(p)) ?? null;
  const text =
    `النظام الذكي - ملخص اليوم (${org.name ?? ""})\n` +
    `المبيعات: ${fmt(sum(sales, "total"))} ${cur} (${sales.length} فاتورة)\n` +
    `التحصيلات: ${fmt(sum(cols, "amount"))} ${cur}\n` +
    `ديون جديدة: ${fmt(sum(sales, "remaining"))} ${cur}`;
  return { phone, text };
}

const isLive = (o: any) => hasFeature(o, "daily_sms"); // daily summary is a plan feature

export const collectSummaries = internalQuery({
  args: {},
  handler: async (ctx) => {
    const orgs = (await ctx.db.query("organizations").collect()).filter((o: any) => isLive(o) && o.daily_sms !== false);
    const out: { phone: string; text: string }[] = [];
    for (const o of orgs) {
      const s = await summarize(ctx, o);
      if (s.phone) out.push({ phone: s.phone, text: s.text });
    }
    return out;
  },
});

// Cron target (see crons.ts).
export const sendAll = internalAction({
  args: {},
  handler: async (ctx): Promise<{ total: number; sent: number }> => {
    const list: { phone: string; text: string }[] = await ctx.runQuery(internal.dailySms.collectSummaries, {});
    let sent = 0;
    for (const s of list) {
      const r = await sendSms(s.phone, s.text);
      if (r.ok) sent++;
      else console.error("daily sms failed", r.status, r.body.slice(0, 200));
    }
    return { total: list.length, sent };
  },
});

// GET /api/org/daily-sms — owner setting + preview of tonight's message.
export const preview = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const user = await require(ctx, token, OWNER);
    const org: any = await orgById(ctx, user.org_id!);
    const s = await summarize(ctx, org);
    return { enabled: org.daily_sms !== false, phone: s.phone, text: s.text, send_hour_local: 21 };
  },
});

// PUT /api/org/daily-sms
export const setEnabled = mutation({
  args: { token: v.string(), enabled: v.boolean() },
  handler: async (ctx, { token, enabled }) => {
    const user = await require(ctx, token, OWNER);
    const org: any = await orgById(ctx, user.org_id!);
    await ctx.db.patch(org._id, { daily_sms: enabled });
    return { enabled };
  },
});

// POST /api/org/daily-sms/test — send today's summary to the owner right now.
export const sendTest = action({
  args: { token: v.string() },
  handler: async (ctx, { token }): Promise<any> => {
    const p: any = await ctx.runQuery(api.dailySms.preview, { token });
    if (!p.phone) throw new Error("لا يوجد رقم هاتف صالح لحساب المالك");
    const r = await sendSms(p.phone, p.text);
    if (!r.ok) throw new Error(smsFailureMessage(r));
    return { ok: true };
  },
});
