"use node";
// Developer 2FA crypto: RFC 6238 TOTP (SHA-1, 6 digits, 30 s — Google Authenticator compatible),
// AES-256-GCM encryption of the secret with TOTP_MASTER_KEY (Convex env only), HMAC'd recovery codes.
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { v } from "convex/values";

import { action } from "./_generated/server";
import { internal } from "./_generated/api";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function b32encode(buf: Buffer) {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function masterKey() {
  const k = Buffer.from(process.env.TOTP_MASTER_KEY ?? "", "base64");
  if (k.length !== 32) throw new Error("خدمة الحماية غير مهيأة");
  return k;
}
function seal(plain: Buffer) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", masterKey(), iv);
  const body = Buffer.concat([c.update(plain), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
}
function unseal(value: string) {
  const [, iv, tag, body] = value.split(".");
  const d = createDecipheriv("aes-256-gcm", masterKey(), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(body, "base64url")), d.final()]);
}

function hotp(secret: Buffer, step: number) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const h = createHmac("sha1", secret).update(msg).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1_000_000).padStart(6, "0");
}
// Returns the matching time-step (±1 step clock drift) or null. Constant-time compare.
function checkTotp(secret: Buffer, code: string) {
  const now = Math.floor(Date.now() / 30000);
  for (const s of [now - 1, now, now + 1]) {
    if (timingSafeEqual(Buffer.from(hotp(secret, s)), Buffer.from(code))) return s;
  }
  return null;
}

const normRecovery = (c: string) => c.toUpperCase().replace(/[^A-Z0-9]/g, "");
const recoveryHash = (c: string) => createHmac("sha256", masterKey()).update(`recovery:${normRecovery(c)}`).digest("hex");
export const deviceHash = (secret: string) => createHash("sha256").update(`dev-device:${secret}`).digest("hex");

function newRecoveryCodes() {
  return Array.from({ length: 10 }, () => randomBytes(5).toString("hex").toUpperCase().match(/.{1,5}/g)!.join("-"));
}

function checkDevice(device_secret: string) {
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(device_secret)) throw new Error("معرّف الجهاز غير صالح");
}
const lbl = (s?: string) => (s ?? "جهاز").slice(0, 60);
const plat = (s?: string) => (s ?? "").slice(0, 20);

// POST /api/dev/sec/setup — first enrolment (no trusted device yet), or reset right after a fresh 2FA/recovery login.
export const setupBegin = action({
  args: { token: v.string() },
  handler: async (ctx, { token }): Promise<any> => {
    const c: any = await ctx.runQuery(internal.devSec.ctxFor, { token });
    const first = !c.totp_enc && c.trusted_count === 0;
    if (!first && !c.recent_mfa) throw new Error("ليس لديك صلاحية لإعادة ضبط المصادقة — تحقق بخطوتين أولاً");
    const secret = randomBytes(20);
    await ctx.runMutation(internal.devSec.savePending, { token, enc: seal(secret) });
    const b32 = b32encode(secret);
    // Generic label: never the developer's name, phone or email.
    const uri = `otpauth://totp/SmartSystem:Admin?secret=${b32}&issuer=SmartSystem&algorithm=SHA1&digits=6&period=30`;
    return { secret: b32, uri };
  },
});

// POST /api/dev/sec/setup/confirm — prove the authenticator works; returns the recovery codes ONCE.
export const setupConfirm = action({
  args: { token: v.string(), code: v.string(), device_secret: v.string(), label: v.optional(v.string()), platform: v.optional(v.string()) },
  handler: async (ctx, a): Promise<any> => {
    checkDevice(a.device_secret);
    const c: any = await ctx.runQuery(internal.devSec.ctxFor, { token: a.token });
    if (!c.pending_enc || c.pending_exp < Date.now()) throw new Error("انتهت مهلة الإعداد، ابدأ من جديد");
    if (c.locked_until_ms > Date.now()) throw new Error("التحقق مقفل مؤقتاً بسبب محاولات خاطئة");
    const code = a.code.trim();
    const step = /^\d{6}$/.test(code) ? checkTotp(unseal(c.pending_enc), code) : null;
    if (step == null) {
      const r: any = await ctx.runMutation(internal.devSec.verifyFail, { token: a.token, label: lbl(a.label), kind: "2fa.setup" });
      throw new Error(r.error);
    }
    const codes = newRecoveryCodes();
    await ctx.runMutation(internal.devSec.confirmSetup, {
      token: a.token, step, hashes: codes.map(recoveryHash), device_hash: deviceHash(a.device_secret), label: lbl(a.label), platform: plat(a.platform),
    });
    return { recovery_codes: codes };
  },
});

// POST /api/dev/sec/verify — authenticator code (6 digits) or a one-time recovery code.
export const verify = action({
  args: { token: v.string(), code: v.string(), device_secret: v.string(), label: v.optional(v.string()), platform: v.optional(v.string()) },
  handler: async (ctx, a): Promise<any> => {
    checkDevice(a.device_secret);
    const c: any = await ctx.runQuery(internal.devSec.ctxFor, { token: a.token });
    if (!c.totp_enc) throw new Error("لم يتم إعداد التحقق بخطوتين بعد");
    if (c.locked_until_ms > Date.now()) throw new Error(`التحقق مقفل مؤقتاً، حاول بعد ${Math.ceil((c.locked_until_ms - Date.now()) / 60000)} دقيقة`);
    const code = a.code.trim();
    if (!code || code.length > 40) throw new Error("أدخل الرمز");
    let step: number | null = null;
    let recovery_hash: string | null = null;
    if (/^\d{6}$/.test(code)) step = checkTotp(unseal(c.totp_enc), code);
    else {
      const h = recoveryHash(code);
      if (c.recovery.some((r: any) => !r.used_at && timingSafeEqual(Buffer.from(r.h, "hex"), Buffer.from(h, "hex")))) recovery_hash = h;
    }
    if (step == null && !recovery_hash) {
      const r: any = await ctx.runMutation(internal.devSec.verifyFail, { token: a.token, label: lbl(a.label), kind: /^\d{6}$/.test(code) ? "2fa" : "recovery" });
      throw new Error(r.error);
    }
    const r: any = await ctx.runMutation(internal.devSec.verifyOk, {
      token: a.token, step, recovery_hash, device_hash: deviceHash(a.device_secret), label: lbl(a.label), platform: plat(a.platform),
    });
    if (r.error) throw new Error(r.error);
    return r;
  },
});

// POST /api/dev/sec/recovery — replace all recovery codes (needs a current authenticator code).
export const regenRecovery = action({
  args: { token: v.string(), code: v.string() },
  handler: async (ctx, a): Promise<any> => {
    const c: any = await ctx.runQuery(internal.devSec.ctxFor, { token: a.token });
    if (!c.verified) throw new Error("صلاحية المطوّر تتطلب التحقق بخطوتين من جهاز موثوق");
    if (c.locked_until_ms > Date.now()) throw new Error("التحقق مقفل مؤقتاً بسبب محاولات خاطئة");
    const code = a.code.trim();
    const step = /^\d{6}$/.test(code) ? checkTotp(unseal(c.totp_enc), code) : null;
    if (step == null) {
      const r: any = await ctx.runMutation(internal.devSec.verifyFail, { token: a.token, label: "", kind: "recovery.regen" });
      throw new Error(r.error);
    }
    const codes = newRecoveryCodes();
    await ctx.runMutation(internal.devSec.setRecovery, { token: a.token, hashes: codes.map(recoveryHash), step });
    return { recovery_codes: codes };
  },
});
