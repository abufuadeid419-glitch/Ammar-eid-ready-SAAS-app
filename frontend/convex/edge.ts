import { v } from "convex/values";

import { action, internalMutation, internalQuery, mutation } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { clean, getUser, newId, nowIso, orgById } from "./lib";

const PHONE_RE = /^\+[1-9]\d{7,14}$/;
const OTP_MAX_PER_HOUR = 5;
const VERIFY_MAX_ATTEMPTS = 5;

const OTP_TTL_MS = 10 * 60 * 1000;

// SMS Gateway for Android (sms-gate.app cloud). Credentials live only in Convex env.
const SMS_GATE_URL = "https://api.sms-gate.app/3rdparty/v1/messages";

function gateHeaders() {
  const u = process.env.SMS_GATE_USERNAME;
  const p = process.env.SMS_GATE_PASSWORD;
  if (!u || !p) throw new Error("خدمة الرسائل غير مهيأة");
  return { Authorization: `Basic ${btoa(`${u}:${p}`)}`, "content-type": "application/json", accept: "application/json" };
}

function gateError(status: number) {
  if (status === 429) return "محاولات كثيرة، يرجى الانتظار قليلاً ثم المحاولة مجدداً";
  if (status === 400 || status === 422) return "رقم الهاتف غير صالح أو غير مدعوم";
  if (status === 401 || status === 403) return "خدمة الرسائل غير مهيأة بشكل صحيح";
  return "تعذر إرسال رمز التحقق، تأكد من اتصال جهاز بوابة الرسائل وحاول لاحقاً";
}

// Codes are never stored in plain text: sha256(pepper:phone:code).
async function hashCode(phone: string, code: string) {
  const data = new TextEncoder().encode(`${process.env.OTP_PEPPER ?? ""}:${phone}:${code}`);
  const d = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(d)).map((x) => x.toString(16).padStart(2, "0")).join("");
}

function randomCode() {
  const n = new Uint32Array(1);
  crypto.getRandomValues(n);
  return String(n[0] % 1000000).padStart(6, "0");
}

// Internal: per-phone rate limit (rolling hour) + store the hashed code for this send.
export const storeOtp = internalMutation({
  args: { phone: v.string(), code_hash: v.string() },
  handler: async (ctx, { phone, code_hash }) => {
    const hourAgo = Date.now() - 3600000;
    const rows = await ctx.db.query("otp_requests").withIndex("by_phone", (q) => q.eq("phone", phone)).collect();
    for (const r of rows) if (r.created_ms < hourAgo) await ctx.db.delete(r._id);
    const recent = rows.filter((r) => r.created_ms >= hourAgo);
    if (recent.length >= OTP_MAX_PER_HOUR) throw new Error("تم تجاوز عدد مرات الإرسال، حاول بعد ساعة");
    const last = recent.sort((x, y) => y.created_ms - x.created_ms)[0];
    if (last && Date.now() - last.created_ms < 30000) throw new Error("انتظر قليلاً قبل طلب رمز جديد");
    return await ctx.db.insert("otp_requests", { phone, created_ms: Date.now(), attempts: 0, code_hash, expires_ms: Date.now() + OTP_TTL_MS });
  },
});

// Internal: a send the SMS gateway rejected must not count toward cooldown / hourly limit.
export const dropOtp = internalMutation({
  args: { id: v.id("otp_requests") },
  handler: async (ctx, { id }) => {
    if (await ctx.db.get(id)) await ctx.db.delete(id);
  },
});

// Send the code via the gateway phone, then poll briefly so a quick failure surfaces as an error.
export async function sendSms(phone: string, text: string) {
  const r = await fetch(SMS_GATE_URL, {
    method: "POST",
    headers: gateHeaders(),
    body: JSON.stringify({
      textMessage: { text },
      phoneNumbers: [phone],
      ttl: 600,
      priority: 100,
      withDeliveryReport: true,
    }),
  });
  if (!r.ok) return { ok: false, status: r.status, body: await r.text() };
  const msg: any = await r.json().catch(() => ({}));
  if (msg?.id) {
    for (let i = 0; i < 4; i++) {
      await new Promise((res) => setTimeout(res, 1500));
      const st: any = await fetch(`${SMS_GATE_URL}/${msg.id}`, { headers: gateHeaders() }).then((x) => x.json()).catch(() => ({}));
      if (st?.state === "Failed") return { ok: false, status: 502, body: JSON.stringify(st.recipients ?? st) };
      if (st?.state === "Sent" || st?.state === "Delivered") break;
    }
  }
  return { ok: true, status: r.status, body: "" };
}

export function smsFailureMessage(r: { status: number; body: string }) {
  if (/No SIMs/i.test(r.body)) return "جهاز بوابة الرسائل لا يحتوي على شريحة SIM فعّالة، أدخل شريحة وحاول مجدداً";
  return gateError(r.status);
}

async function sendOtp(ctx: any, phone: string) {
  const code = randomCode();
  const otpId = await ctx.runMutation(internal.edge.storeOtp, { phone, code_hash: await hashCode(phone, code) });
  const sms = await sendSms(phone, `رمز التحقق في النظام الذكي: ${code}\nصالح لمدة 10 دقائق. لا تشاركه مع أحد.`);
  if (sms.ok) return { ok: true, channel: "sms" };
  console.error("sms-gate failed", sms.status, sms.body.slice(0, 300));
  await ctx.runMutation(internal.edge.dropOtp, { id: otpId });
  throw new Error(smsFailureMessage(sms));
}

// POST /api/auth/otp/request — send the code by SMS through the SMS Gateway (SMS only).
// Used for first sign-up, resend, and "forgot password".
export const requestOtp = action({
  args: { phone: v.string(), channel: v.optional(v.string()) },
  handler: async (ctx, { phone: raw }) => {
    const phone = raw.trim();
    if (!PHONE_RE.test(phone)) throw new Error("أدخل رقم هاتف صحيح مع رمز الدولة");
    return await sendOtp(ctx, phone);
  },
});

// POST /api/auth/start — numbers that already have a password log in with it; others get an SMS code.
export const start = action({
  args: { phone: v.string() },
  handler: async (ctx, { phone: raw }): Promise<any> => {
    const phone = raw.trim();
    if (!PHONE_RE.test(phone)) throw new Error("أدخل رقم هاتف صحيح مع رمز الدولة");
    const rec: any = await ctx.runQuery(internal.edge.pwRecord, { phone });
    if (rec?.hash) return { method: "password" };
    const r = await sendOtp(ctx, phone);
    return { method: "otp", channel: r.channel };
  },
});

// Internal: password record for a phone (salt/hash/lock state) — never exposed over HTTP.
export const pwRecord = internalQuery({
  args: { phone: v.string() },
  handler: async (ctx, { phone }) => {
    const user = await ctx.db.query("users").withIndex("by_phone", (q) => q.eq("phone", phone)).unique();
    if (!user) return null;
    const rec = await ctx.db.query("user_passwords").withIndex("by_user", (q) => q.eq("user_id", user.user_id)).unique();
    return rec ? { hash: rec.hash, salt: rec.salt, locked_until_ms: rec.locked_until_ms ?? 0 } : null;
  },
});

const PW_MAX_FAILS = 5;
const PW_LOCK_MS = 15 * 60 * 1000;

// Internal: record a password attempt; on success open a session (same one-device rule as SMS login).
export const pwResult = internalMutation({
  args: { phone: v.string(), ok: v.boolean(), session_token: v.string(), force: v.optional(v.boolean()) },
  handler: async (ctx, { phone, ok, session_token, force }): Promise<any> => {
    const user = await ctx.db.query("users").withIndex("by_phone", (q) => q.eq("phone", phone)).unique();
    const rec = user ? await ctx.db.query("user_passwords").withIndex("by_user", (q) => q.eq("user_id", user.user_id)).unique() : null;
    if (!user || !rec) return { error: "رقم الهاتف أو كلمة المرور غير صحيحة" };
    if (!ok) return await recordFail(ctx, rec);
    if (!(await takeOverDevice(ctx, user.user_id, !!force))) return { conflict: true };
    await ctx.db.patch(rec._id, { failed: 0, locked_until_ms: 0 });
    return await openSession(ctx, phone, session_token, false);
  },
});

async function recordFail(ctx: any, rec: any) {
  const failed = (rec.failed ?? 0) + 1;
  if (failed >= PW_MAX_FAILS) {
    await ctx.db.patch(rec._id, { failed: 0, locked_until_ms: Date.now() + PW_LOCK_MS });
    return { error: "محاولات خاطئة كثيرة، تم إيقاف الدخول بكلمة المرور 15 دقيقة. يمكنك استخدام \"نسيت كلمة المرور\"" };
  }
  await ctx.db.patch(rec._id, { failed });
  return { error: `كلمة المرور غير صحيحة (متبقي ${PW_MAX_FAILS - failed} محاولات)` };
}

// Internal: password record of the signed-in user (for change-password).
export const pwRecordByToken = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const user: any = await getUser(ctx, token);
    const rec = await ctx.db.query("user_passwords").withIndex("by_user", (q) => q.eq("user_id", user.user_id)).unique();
    return rec ? { user_id: user.user_id, hash: rec.hash, salt: rec.salt, locked_until_ms: rec.locked_until_ms ?? 0 } : null;
  },
});

export const pwFail = internalMutation({
  args: { user_id: v.string() },
  handler: async (ctx, { user_id }) => {
    const rec = await ctx.db.query("user_passwords").withIndex("by_user", (q) => q.eq("user_id", user_id)).unique();
    return rec ? await recordFail(ctx, rec) : { error: "كلمة المرور غير صحيحة" };
  },
});

// Internal: save a password hash. Allowed when none exists yet, or within 15 min of an SMS-verified login.
export const pwStore = internalMutation({
  args: { token: v.string(), salt: v.string(), hash: v.string(), verified: v.optional(v.boolean()) },
  handler: async (ctx, { token, salt, hash, verified }) => {
    const user: any = await getUser(ctx, token);
    const sess = await ctx.db.query("user_sessions").withIndex("by_token", (q) => q.eq("session_token", token)).unique();
    const rec = await ctx.db.query("user_passwords").withIndex("by_user", (q) => q.eq("user_id", user.user_id)).unique();
    // `verified` = the current password was just confirmed by pw.changePassword (internal only).
    if (rec && !verified && !((sess?.pw_reset_until ?? 0) > Date.now())) throw new Error("لتغيير كلمة المرور سجّل الدخول برمز SMS عبر \"نسيت كلمة المرور\"");
    const doc = { user_id: user.user_id, hash, salt, failed: 0, locked_until_ms: 0, updated_at: nowIso() };
    if (rec) await ctx.db.patch(rec._id, doc);
    else await ctx.db.insert("user_passwords", doc);
    if (sess) await ctx.db.patch(sess._id, { pw_reset_until: 0 });
    // A new password signs out every other device.
    for (const s of await ctx.db.query("user_sessions").withIndex("by_user", (q) => q.eq("user_id", user.user_id)).collect()) {
      if (s.session_token !== token) await ctx.db.delete(s._id);
    }
    return { ok: true };
  },
});

// One device per account: returns false when another live session exists and the user hasn't agreed to move it.
async function takeOverDevice(ctx: any, user_id: string, force: boolean) {
  const live = (await ctx.db.query("user_sessions").withIndex("by_user", (q: any) => q.eq("user_id", user_id)).collect()).filter(
    (s: any) => !s.expires_at || Date.parse(s.expires_at) > Date.now(),
  );
  if (live.length && !force) return false;
  for (const s of live) await ctx.db.delete(s._id);
  return true;
}

// POST /api/auth/otp/verify — check the code against the latest request; on success open a session.
export const verifyOtp = action({
  args: { phone: v.string(), code: v.string(), force: v.optional(v.boolean()) },
  handler: async (ctx, { phone: raw, code, force }): Promise<any> => {
    const phone = raw.trim();
    if (!PHONE_RE.test(phone) || !/^\d{6}$/.test(code.trim())) throw new Error("رمز التحقق غير صحيح");
    const session_token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, "");
    const res: any = await ctx.runMutation(internal.edge.checkOtp, { phone, code_hash: await hashCode(phone, code.trim()), session_token, force: !!force });
    if (res.conflict) throw new Error("DEVICE_CONFLICT");
    if (res.error) throw new Error(res.error);
    return res;
  },
});

// Internal: attempt-limited code check; returns an error message (so the attempt count persists) or a session.
export const checkOtp = internalMutation({
  args: { phone: v.string(), code_hash: v.string(), session_token: v.string(), force: v.optional(v.boolean()) },
  handler: async (ctx, { phone, code_hash, session_token, force }): Promise<any> => {
    const rows = await ctx.db.query("otp_requests").withIndex("by_phone", (q) => q.eq("phone", phone)).collect();
    const last = rows.sort((x, y) => y.created_ms - x.created_ms)[0];
    if (!last || !last.code_hash) return { error: "اطلب رمز تحقق أولاً" };
    if ((last.attempts ?? 0) >= VERIFY_MAX_ATTEMPTS) return { error: "محاولات خاطئة كثيرة، اطلب رمزاً جديداً" };
    if ((last.expires_ms ?? 0) < Date.now()) return { error: "انتهت صلاحية الرمز، اطلب رمزاً جديداً" };
    if (last.code_hash !== code_hash) {
      await ctx.db.patch(last._id, { attempts: (last.attempts ?? 0) + 1 });
      return { error: "رمز التحقق غير صحيح" };
    }
    // One device per account (like WhatsApp): an active session elsewhere needs explicit consent;
    // the code is NOT consumed so the client can retry with force=true.
    const existing = await ctx.db.query("users").withIndex("by_phone", (q) => q.eq("phone", phone)).unique();
    if (existing && !(await takeOverDevice(ctx, existing.user_id, !!force))) return { conflict: true };
    return await openSession(ctx, phone, session_token, true);
  },
});

// Hashed-phone comparison for developer accounts.
// Phones are never stored or compared in plain text: sha256(pepper:phone).
async function hashPhone(phone: string) {
  const data = new TextEncoder().encode(`${process.env.OTP_PEPPER ?? ""}:${phone}`);
  const d = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(d)).map((x) => x.toString(16).padStart(2, "0")).join("");
}

// Find-or-create the user by verified phone and open a 30-day session.
async function openSession(ctx: any, phone: string, session_token: string, viaOtp: boolean) {
  {
    // (block kept for indentation parity with the former mutation handler)
    // Developer accounts are identified by HASHED phone, listed in the Convex
    // deployment env var DEVELOPER_PHONES_HASH (comma-separated sha256(pepper:phone)
    // hex). The plaintext phone is NEVER stored in env or code.
    const devHashes = (process.env.DEVELOPER_PHONES_HASH ?? "").split(",").map((p) => p.trim().toLowerCase()).filter(Boolean);
    const isDev = devHashes.length > 0 && devHashes.includes((await hashPhone(phone)).toLowerCase());
    const existing = await ctx.db.query("users").withIndex("by_phone", (q: any) => q.eq("phone", phone)).unique();
    let user_id: string;
    if (existing) {
      user_id = existing.user_id;
      if (isDev && existing.role !== "DEVELOPER") await ctx.db.patch(existing._id, { role: "DEVELOPER", employee_type: null, org_id: null });
    } else {
      user_id = `user_${newId().slice(0, 12)}`;
      // `email` doubles as the display identifier across the app; for phone accounts it holds the phone.
      await ctx.db.insert("users", { user_id, phone, email: phone, name: null, picture: null, role: isDev ? "DEVELOPER" : null, employee_type: null, org_id: null, consent_at: null, created_at: nowIso() });
    }
    // Used OTP rows are no longer needed.
    for (const o of await ctx.db.query("otp_requests").withIndex("by_phone", (q: any) => q.eq("phone", phone)).collect()) await ctx.db.delete(o._id);
    await ctx.db.insert("user_sessions", {
      session_token, user_id, device_id: newId(), last_seen_at: nowIso(),
      expires_at: new Date(Date.now() + 30 * 86400000).toISOString(), created_at: nowIso(),
      ...(viaOtp ? { pw_reset_until: Date.now() + 15 * 60 * 1000 } : {}),
    });
    const user: any = await ctx.db.query("users").withIndex("by_user_id", (q: any) => q.eq("user_id", user_id)).unique();
    const pw = await ctx.db.query("user_passwords").withIndex("by_user", (q: any) => q.eq("user_id", user_id)).unique();
    const out: any = { ...clean(user), has_password: !!pw, org: null };
    if (user.org_id) out.org = clean(await orgById(ctx, user.org_id));
    return { session_token, user: out };
  }
}

// POST /api/auth/name — new phone accounts set their display name once.
export const setName = mutation({
  args: { token: v.string(), name: v.string() },
  handler: async (ctx, { token, name }) => {
    const user: any = await getUser(ctx, token);
    const n = name.trim();
    if (n.length < 2 || n.length > 60) throw new Error("أدخل اسماً صحيحاً");
    await ctx.db.patch(user._id, { name: n });
    return { ok: true, name: n };
  },
});

// Internal (CLI only, `npx convex run edge:seedTestAccounts`): seeded org + bearer sessions for automated tests.
export const seedTestAccounts = internalMutation({
  args: {},
  handler: async (ctx) => {
    const org_id = "org_test_1";
    const org0: any = await orgById(ctx, org_id);
    if (org0) await ctx.db.patch(org0._id, { status: "ACTIVE", expires_at: new Date(Date.now() + 365 * 86400000).toISOString() } as any);
    else {
      await ctx.db.insert("organizations", { id: org_id, name: "TEST مؤسسة الاختبار", owner_id: "user_test_owner", plan: "LICENSE", status: "ACTIVE", max_employees: 15, expires_at: new Date(Date.now() + 365 * 86400000).toISOString(), created_at: nowIso() } as any);
    }
    const people = [
      ["user_test_dev", "+963900000001", "مطور الاختبار", "DEVELOPER", null, null, "test_token_dev"],
      ["user_test_owner", "+963900000002", "مالك الاختبار", "OWNER", null, org_id, "test_token_owner"],
      ["user_test_acct", "+963900000003", "محاسب الاختبار", "EMPLOYEE", "ACCOUNTANT", org_id, "test_token_acct"],
      ["user_test_agent", "+963900000004", "موزع الاختبار", "EMPLOYEE", "FIELD_AGENT", org_id, "test_token_agent"],
    ] as const;
    for (const [user_id, phone, name, role, employee_type, oid, token] of people) {
      const ex = await ctx.db.query("users").withIndex("by_user_id", (q) => q.eq("user_id", user_id)).unique();
      const doc = { user_id, phone, email: phone, name, picture: null, role, employee_type, org_id: oid, consent_at: nowIso() };
      if (ex) await ctx.db.patch(ex._id, doc);
      else await ctx.db.insert("users", { ...doc, created_at: nowIso() });
      const s = await ctx.db.query("user_sessions").withIndex("by_token", (q) => q.eq("session_token", token)).unique();
      if (!s) await ctx.db.insert("user_sessions", { session_token: token, user_id, expires_at: new Date(Date.now() + 365 * 86400000).toISOString(), created_at: nowIso() });
    }
    return { ok: true };
  },
});

// Internal: stamp the org with its logo storage id.
export const setLogo = mutation({
  args: { token: v.string(), storageId: v.string(), content_type: v.string() },
  handler: async (ctx, { token, storageId, content_type }) => {
    const sess = await ctx.db.query("user_sessions").withIndex("by_token", (q) => q.eq("session_token", token)).unique();
    if (!sess) throw new Error("الجلسة غير صالحة");
    const user: any = await ctx.db.query("users").withIndex("by_user_id", (q) => q.eq("user_id", sess.user_id)).unique();
    if (!user || user.role !== "OWNER") throw new Error("ليس لديك صلاحية");
    const org: any = await orgById(ctx, user.org_id);
    await ctx.db.patch(org._id, { logo_storage: storageId, logo_type: content_type });
    return { ok: true };
  },
});

export const getLogoId = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const sess = await ctx.db.query("user_sessions").withIndex("by_token", (q) => q.eq("session_token", token)).unique();
    if (!sess) throw new Error("الجلسة غير صالحة");
    const user: any = await ctx.db.query("users").withIndex("by_user_id", (q) => q.eq("user_id", sess.user_id)).unique();
    const org: any = user?.org_id ? await orgById(ctx, user.org_id) : null;
    return { storage: org?.logo_storage ?? null, type: org?.logo_type ?? "image/jpeg" };
  },
});

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// POST /api/org/logo — store the base64 logo in Convex file storage.
export const uploadLogo = action({
  args: { token: v.string(), data: v.string(), content_type: v.optional(v.string()) },
  handler: async (ctx, { token, data, content_type }): Promise<any> => {
    const ct = content_type ?? "image/jpeg";
    const bytes = b64ToBytes(data.split(",").pop() as string);
    if (bytes.length > 1_500_000) throw new Error("حجم الشعار كبير جداً (الحد 1.5MB)");
    const storageId = await ctx.storage.store(new Blob([bytes], { type: ct }));
    await ctx.runMutation(api.edge.setLogo, { token, storageId, content_type: ct });
    return { ok: true };
  },
});

// GET /api/org/logo — return the logo as a data URI (keeps the existing frontend contract).
export const getLogo = action({
  args: { token: v.string() },
  handler: async (ctx, { token }): Promise<any> => {
    const info: any = await ctx.runMutation(api.edge.getLogoId, { token });
    if (!info.storage) return { data_uri: null };
    const blob = await ctx.storage.get(info.storage);
    if (!blob) return { data_uri: null };
    const buf = new Uint8Array(await blob.arrayBuffer());
    let bin = "";
    for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
    return { data_uri: `data:${info.type};base64,${btoa(bin)}` };
  },
});
