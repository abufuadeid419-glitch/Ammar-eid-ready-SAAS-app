// Developer account security: 2FA state, trusted devices (approval by an existing trusted device),
// lockout, session revocation and an access log. Crypto (TOTP / AES / hashing) lives in devSecNode.ts.
import { v } from "convex/values";

import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { devSessionOk, getSession, getUser, newId } from "./lib";

export const MAX_FAILS = 5;
export const LOCK_MS = 15 * 60 * 1000;
const PENDING_MS = 10 * 60 * 1000;
export const DEV_SESSION_MS = 24 * 3600 * 1000;
const RECENT_MFA_MS = 10 * 60 * 1000;

async function devUser(ctx: any, token: string, full: boolean) {
  const user: any = await getUser(ctx, token, { devPending: !full });
  if (user.role !== "DEVELOPER") throw new Error("ليس لديك صلاحية");
  return user;
}

async function secOf(ctx: any, user_id: string) {
  return await ctx.db.query("dev_security").withIndex("by_user", (q: any) => q.eq("user_id", user_id)).unique();
}

export async function devLog(ctx: any, event: string, ok: boolean, extra: { user_id?: string; device?: string; detail?: string } = {}) {
  await ctx.db.insert("dev_access_logs", { event, ok, ...extra, at: Date.now() });
}

const mfaPatch = (hash: string) => ({
  dev_mfa: true, dev_device: hash, dev_mfa_at: Date.now(), dev_pending_device: null,
  expires_at: new Date(Date.now() + DEV_SESSION_MS).toISOString(),
});

function randomCode() {
  const n = new Uint32Array(1);
  crypto.getRandomValues(n);
  return String(n[0] % 1000000).padStart(6, "0");
}

async function trustDevice(ctx: any, user_id: string, hash: string, label: string, platform: string) {
  const ex: any = await ctx.db.query("dev_devices").withIndex("by_hash", (q: any) => q.eq("device_hash", hash)).first();
  const doc = { status: "trusted", label, platform, approved_at: Date.now(), last_seen_at: Date.now(), approve_code: null, expires_ms: null };
  if (ex && ex.user_id === user_id) await ctx.db.patch(ex._id, doc);
  else await ctx.db.insert("dev_devices", { id: newId(), user_id, device_hash: hash, created_at: Date.now(), ...doc });
}

// GET /api/dev/sec/status — what the 2FA screen must show for this session.
export const status = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const user = await devUser(ctx, token, false);
    const sess: any = await getSession(ctx, token);
    const sec: any = await secOf(ctx, user.user_id);
    const devices = await ctx.db.query("dev_devices").withIndex("by_user", (q) => q.eq("user_id", user.user_id)).collect();
    const pend: any = sess.dev_pending_device ? devices.find((d: any) => d.id === sess.dev_pending_device) : null;
    return {
      enrolled: !!sec?.totp_enc,
      verified: await devSessionOk(ctx, sess),
      locked_minutes: sec?.locked_until_ms > Date.now() ? Math.ceil((sec.locked_until_ms - Date.now()) / 60000) : 0,
      has_trusted: devices.some((d: any) => d.status === "trusted"),
      recovery_left: (sec?.recovery ?? []).filter((r: any) => !r.used_at).length,
      pending: pend && pend.status === "pending" && pend.expires_ms > Date.now() ? { code: pend.approve_code, expires_ms: pend.expires_ms } : null,
      pending_state: pend?.status ?? null,
    };
  },
});

// Internal: everything the Node verifier needs (encrypted secrets / hashes never leave the server).
export const ctxFor = internalQuery({
  args: { token: v.string(), device_hash: v.optional(v.string()) },
  handler: async (ctx, { token, device_hash }) => {
    const user = await devUser(ctx, token, false);
    const sess: any = await getSession(ctx, token);
    const sec: any = await secOf(ctx, user.user_id);
    const devices = await ctx.db.query("dev_devices").withIndex("by_user", (q) => q.eq("user_id", user.user_id)).collect();
    const verified = await devSessionOk(ctx, sess);
    return {
      user_id: user.user_id,
      totp_enc: sec?.totp_enc ?? null, pending_enc: sec?.pending_enc ?? null, pending_exp: sec?.pending_exp ?? 0,
      last_step: sec?.last_step ?? 0, recovery: sec?.recovery ?? [], locked_until_ms: sec?.locked_until_ms ?? 0,
      trusted_count: devices.filter((d: any) => d.status === "trusted").length,
      verified, recent_mfa: verified && Date.now() - (sess.dev_mfa_at ?? 0) < RECENT_MFA_MS,
      device_status: device_hash ? devices.find((d: any) => d.device_hash === device_hash)?.status ?? null : null,
    };
  },
});

export const savePending = internalMutation({
  args: { token: v.string(), enc: v.string() },
  handler: async (ctx, { token, enc }) => {
    const user = await devUser(ctx, token, false);
    const sec: any = await secOf(ctx, user.user_id);
    const patch = { pending_enc: enc, pending_exp: Date.now() + PENDING_MS };
    if (sec) await ctx.db.patch(sec._id, patch);
    else await ctx.db.insert("dev_security", { user_id: user.user_id, failed: 0, locked_until_ms: 0, recovery: [], ...patch });
    await devLog(ctx, "2fa.setup_started", true, { user_id: user.user_id });
  },
});

// Authenticator confirmed: activate the new secret, store recovery hashes, trust this device, verify the session.
export const confirmSetup = internalMutation({
  args: { token: v.string(), step: v.number(), hashes: v.array(v.string()), device_hash: v.string(), label: v.string(), platform: v.string() },
  handler: async (ctx, a) => {
    const user = await devUser(ctx, a.token, false);
    const sec: any = await secOf(ctx, user.user_id);
    if (!sec?.pending_enc || sec.pending_exp < Date.now()) throw new Error("انتهت مهلة الإعداد، ابدأ من جديد");
    const reset = !!sec.totp_enc;
    await ctx.db.patch(sec._id, {
      totp_enc: sec.pending_enc, pending_enc: null, pending_exp: 0, last_step: a.step, failed: 0, locked_until_ms: 0,
      recovery: a.hashes.map((h) => ({ h, used_at: null })), enrolled_at: Date.now(),
    });
    await trustDevice(ctx, user.user_id, a.device_hash, a.label, a.platform);
    const sess: any = await getSession(ctx, a.token);
    await ctx.db.patch(sess._id, mfaPatch(a.device_hash) as any);
    await devLog(ctx, reset ? "2fa.reset" : "2fa.enabled", true, { user_id: user.user_id, device: a.label });
    return { ok: true };
  },
});

export const verifyFail = internalMutation({
  args: { token: v.string(), label: v.string(), kind: v.string() },
  handler: async (ctx, { token, label, kind }) => {
    const user = await devUser(ctx, token, false);
    const sec: any = await secOf(ctx, user.user_id);
    const failed = (sec?.failed ?? 0) + 1;
    const lock = failed >= MAX_FAILS;
    if (sec) await ctx.db.patch(sec._id, lock ? { failed: 0, locked_until_ms: Date.now() + LOCK_MS } : { failed });
    await devLog(ctx, `${kind}.fail`, false, { user_id: user.user_id, device: label });
    if (lock) {
      await devLog(ctx, "2fa.locked", false, { user_id: user.user_id, device: label });
      // Lockout also ends the half-authenticated session.
      const sess: any = await getSession(ctx, token);
      await ctx.db.delete(sess._id);
      return { error: "محاولات خاطئة كثيرة — تم قفل التحقق 15 دقيقة وتسجيل خروجك" };
    }
    return { error: `الرمز غير صحيح (متبقي ${MAX_FAILS - failed} محاولات)` };
  },
});

// Second factor passed. Trusted device → verified; recovery code → device trusted; otherwise wait for approval.
export const verifyOk = internalMutation({
  args: { token: v.string(), step: v.union(v.number(), v.null()), recovery_hash: v.union(v.string(), v.null()), device_hash: v.string(), label: v.string(), platform: v.string() },
  handler: async (ctx, a) => {
    const user = await devUser(ctx, a.token, false);
    const sec: any = await secOf(ctx, user.user_id);
    const patch: any = { failed: 0 };
    if (a.step != null) {
      if (a.step <= (sec.last_step ?? 0)) return { error: "تم استخدام هذا الرمز، انتظر الرمز التالي" };
      patch.last_step = a.step;
    }
    if (a.recovery_hash) {
      const rec = (sec.recovery ?? []).map((r: any) => ({ ...r }));
      const hit = rec.find((r: any) => r.h === a.recovery_hash && !r.used_at);
      if (!hit) return { error: "رمز الاسترداد غير صالح" };
      hit.used_at = Date.now();
      patch.recovery = rec;
    }
    await ctx.db.patch(sec._id, patch);
    const sess: any = await getSession(ctx, a.token);
    const dev: any = await ctx.db.query("dev_devices").withIndex("by_hash", (q) => q.eq("device_hash", a.device_hash)).first();
    const mine = dev && dev.user_id === user.user_id ? dev : null;
    if (mine?.status === "trusted" || a.recovery_hash) {
      await trustDevice(ctx, user.user_id, a.device_hash, a.label, a.platform);
      await ctx.db.patch(sess._id, mfaPatch(a.device_hash) as any);
      await devLog(ctx, a.recovery_hash ? "recovery.used" : "2fa.ok", true, { user_id: user.user_id, device: a.label });
      return { status: "ok" };
    }
    if (mine?.status === "revoked") {
      await devLog(ctx, "device.revoked_attempt", false, { user_id: user.user_id, device: a.label });
      return { error: "تم إلغاء هذا الجهاز. استخدم رمز استرداد لإعادة اعتماده" };
    }
    // Unknown device: create an approval request that a trusted device must confirm with this code.
    const code = randomCode();
    const req = { status: "pending", label: a.label, platform: a.platform, approve_code: code, expires_ms: Date.now() + PENDING_MS, created_at: Date.now() };
    let id: string;
    if (mine) { id = mine.id; await ctx.db.patch(mine._id, req); }
    else { id = newId(); await ctx.db.insert("dev_devices", { id, user_id: user.user_id, device_hash: a.device_hash, ...req }); }
    await ctx.db.patch(sess._id, { dev_pending_device: id, dev_pending_hash: a.device_hash } as any);
    await devLog(ctx, "device.pending", true, { user_id: user.user_id, device: a.label });
    return { status: "pending", code };
  },
});

export const setRecovery = internalMutation({
  args: { token: v.string(), hashes: v.array(v.string()), step: v.number() },
  handler: async (ctx, a) => {
    const user = await devUser(ctx, a.token, true);
    const sec: any = await secOf(ctx, user.user_id);
    if (a.step <= (sec.last_step ?? 0)) throw new Error("تم استخدام هذا الرمز، انتظر الرمز التالي");
    await ctx.db.patch(sec._id, { recovery: a.hashes.map((h) => ({ h, used_at: null })), last_step: a.step, failed: 0 });
    await devLog(ctx, "recovery.regenerated", true, { user_id: user.user_id });
  },
});

// GET /api/dev/sec/devices — trusted + pending devices (hashes never returned).
export const devices = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const user = await devUser(ctx, token, true);
    const sess: any = await getSession(ctx, token);
    const rows = await ctx.db.query("dev_devices").withIndex("by_user", (q) => q.eq("user_id", user.user_id)).collect();
    return rows
      .filter((d: any) => d.status === "trusted" || (d.status === "pending" && d.expires_ms > Date.now()))
      .map((d: any) => ({ id: d.id, label: d.label ?? "جهاز", platform: d.platform ?? null, status: d.status, current: d.device_hash === sess.dev_device, approved_at: d.approved_at ?? null, created_at: d.created_at ?? null, expires_ms: d.expires_ms ?? null }))
      .sort((a, b) => (a.status === "pending" ? -1 : b.status === "pending" ? 1 : a.current ? -1 : b.current ? 1 : 0));
  },
});

// A trusted device approves a pending one by typing the code displayed on the new device.
export const approve = mutation({
  args: { token: v.string(), id: v.string(), code: v.string() },
  handler: async (ctx, { token, id, code }) => {
    const user = await devUser(ctx, token, true);
    const d: any = await ctx.db.query("dev_devices").withIndex("by_biz_id", (q) => q.eq("id", id)).unique();
    if (!d || d.user_id !== user.user_id || d.status !== "pending" || d.expires_ms < Date.now()) throw new Error("طلب الجهاز غير موجود أو انتهت صلاحيته");
    if (String(code).trim() !== d.approve_code) {
      const tries = (d.approve_tries ?? 0) + 1;
      await ctx.db.patch(d._id, tries >= 3 ? { status: "denied", approve_tries: tries } : { approve_tries: tries });
      await devLog(ctx, "device.approve_fail", false, { user_id: user.user_id, device: d.label });
      throw new Error(tries >= 3 ? "رموز خاطئة كثيرة — تم رفض الجهاز" : "رمز الموافقة غير مطابق");
    }
    await ctx.db.patch(d._id, { status: "trusted", approved_at: Date.now(), approve_code: null, expires_ms: null });
    for (const s of await ctx.db.query("user_sessions").withIndex("by_user", (q) => q.eq("user_id", user.user_id)).collect()) {
      if ((s as any).dev_pending_device === id) await ctx.db.patch(s._id, mfaPatch(d.device_hash) as any);
    }
    await devLog(ctx, "device.approved", true, { user_id: user.user_id, device: d.label });
    return { ok: true };
  },
});

async function killDevice(ctx: any, user_id: string, d: any, status: string) {
  await ctx.db.patch(d._id, { status, approve_code: null, revoked_at: Date.now() });
  for (const s of await ctx.db.query("user_sessions").withIndex("by_user", (q: any) => q.eq("user_id", user_id)).collect()) {
    if (s.dev_device === d.device_hash || s.dev_pending_device === d.id) await ctx.db.delete(s._id);
  }
}

export const deny = mutation({
  args: { token: v.string(), id: v.string() },
  handler: async (ctx, { token, id }) => {
    const user = await devUser(ctx, token, true);
    const d: any = await ctx.db.query("dev_devices").withIndex("by_biz_id", (q) => q.eq("id", id)).unique();
    if (!d || d.user_id !== user.user_id) throw new Error("الجهاز غير موجود");
    await killDevice(ctx, user.user_id, d, "denied");
    await devLog(ctx, "device.denied", true, { user_id: user.user_id, device: d.label });
    return { ok: true };
  },
});

export const revokeDevice = mutation({
  args: { token: v.string(), id: v.string() },
  handler: async (ctx, { token, id }) => {
    const user = await devUser(ctx, token, true);
    const d: any = await ctx.db.query("dev_devices").withIndex("by_biz_id", (q) => q.eq("id", id)).unique();
    if (!d || d.user_id !== user.user_id) throw new Error("الجهاز غير موجود");
    await killDevice(ctx, user.user_id, d, "revoked");
    await devLog(ctx, "device.revoked", true, { user_id: user.user_id, device: d.label });
    return { ok: true };
  },
});

// Emergency: sign out every developer session and un-trust every device (optionally keeping this one).
export const revokeAll = mutation({
  args: { token: v.string(), include_current: v.optional(v.boolean()) },
  handler: async (ctx, { token, include_current }) => {
    const user = await devUser(ctx, token, true);
    const sess: any = await getSession(ctx, token);
    let n = 0;
    for (const d of await ctx.db.query("dev_devices").withIndex("by_user", (q) => q.eq("user_id", user.user_id)).collect()) {
      if (!include_current && d.device_hash === sess.dev_device) continue;
      if (d.status === "trusted" || d.status === "pending") { await ctx.db.patch(d._id, { status: "revoked", approve_code: null, revoked_at: Date.now() } as any); n++; }
    }
    for (const s of await ctx.db.query("user_sessions").withIndex("by_user", (q) => q.eq("user_id", user.user_id)).collect()) {
      if (include_current || s._id !== sess._id) await ctx.db.delete(s._id);
    }
    await devLog(ctx, include_current ? "sessions.revoke_all_including_current" : "sessions.revoke_all", true, { user_id: user.user_id, detail: `${n}` });
    return { ok: true, revoked_devices: n };
  },
});

// GET /api/dev/sec/logs — recent security events (no secrets, no phone numbers).
export const logs = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const user = await devUser(ctx, token, true);
    const rows = (await ctx.db.query("dev_access_logs").withIndex("by_at").order("desc").take(500)).filter((r: any) => !r.user_id || r.user_id === user.user_id).slice(0, 100);
    return rows.map((r: any) => ({ event: r.event, ok: r.ok, device: r.device ?? null, detail: r.detail ?? null, at: r.at }));
  },
});

// Internal (CLI only — needs the deploy key): seed / purge a throw-away developer for automated security tests.
// Restricted to the reserved test number range; the phone must ALSO be in DEVELOPER_PHONES_HASH to get any access.
const TEST_RANGE = /^\+96390000000\d$/;
export const testSeed = internalMutation({
  args: { phone: v.string(), token: v.string() },
  handler: async (ctx, { phone, token }) => {
    if (!TEST_RANGE.test(phone)) throw new Error("test range only");
    const user_id = `user_sectest_${phone.slice(-1)}`;
    const ex = await ctx.db.query("users").withIndex("by_user_id", (q) => q.eq("user_id", user_id)).unique();
    if (!ex) await ctx.db.insert("users", { user_id, phone, email: phone, name: "Sec Test", picture: null, role: "DEVELOPER", employee_type: null, org_id: null, consent_at: new Date().toISOString(), created_at: new Date().toISOString() } as any);
    await ctx.db.insert("user_sessions", { session_token: token, user_id, expires_at: new Date(Date.now() + DEV_SESSION_MS).toISOString(), created_at: new Date().toISOString(), pw_reset_until: Date.now() + 15 * 60 * 1000 } as any);
    return { user_id };
  },
});
export const testPurge = internalMutation({
  args: { phone: v.string() },
  handler: async (ctx, { phone }) => {
    if (!TEST_RANGE.test(phone)) throw new Error("test range only");
    const user_id = `user_sectest_${phone.slice(-1)}`;
    for (const t of ["user_sessions", "user_passwords", "dev_security", "dev_devices"] as const)
      for (const r of await ctx.db.query(t as any).withIndex("by_user", (q: any) => q.eq("user_id", user_id)).collect()) await ctx.db.delete(r._id);
    for (const r of await ctx.db.query("dev_access_logs").collect()) if ((r as any).user_id === user_id) await ctx.db.delete(r._id);
    const u = await ctx.db.query("users").withIndex("by_user_id", (q) => q.eq("user_id", user_id)).unique();
    if (u) await ctx.db.delete(u._id);
    return { ok: true };
  },
});
