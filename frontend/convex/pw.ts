"use node";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { v } from "convex/values";

import { action } from "./_generated/server";
import { internal } from "./_generated/api";

const PHONE_RE = /^\+[1-9]\d{7,14}$/;
const DUMMY_SALT = "a3f1c9e07b2d4e6f8a1b3c5d7e9f0a2b";
const BAD_LOGIN = "رقم الهاتف أو كلمة المرور غير صحيحة";

// scrypt (memory-hard) with a per-user random salt.
function derive(password: string, salt: string) {
  return scryptSync(password, Buffer.from(salt, "hex"), 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString("hex");
}

// POST /api/auth/password/login — phone + password; per-phone lockout after repeated failures.
export const login = action({
  args: { phone: v.string(), password: v.string(), force: v.optional(v.boolean()) },
  handler: async (ctx, { phone: raw, password, force }): Promise<any> => {
    const phone = raw.trim();
    if (!PHONE_RE.test(phone) || !password || password.length > 128) throw new Error(BAD_LOGIN);
    const rec: any = await ctx.runQuery(internal.edge.pwRecord, { phone });
    if (rec?.locked_until_ms && rec.locked_until_ms > Date.now()) {
      const mins = Math.ceil((rec.locked_until_ms - Date.now()) / 60000);
      throw new Error(`محاولات خاطئة كثيرة، حاول بعد ${mins} دقيقة أو استخدم "نسيت كلمة المرور"`);
    }
    // Always hash (even for unknown phones) so response time does not reveal accounts.
    const hash = derive(password, rec?.salt ?? DUMMY_SALT);
    const ok = !!rec?.hash && timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(rec.hash, "hex"));
    const session_token = randomBytes(32).toString("hex");
    const res: any = await ctx.runMutation(internal.edge.pwResult, { phone, ok, session_token, force: !!force });
    if (res.conflict) throw new Error("DEVICE_CONFLICT");
    if (res.error) throw new Error(res.error);
    return res;
  },
});

function checkStrength(password: string) {
  if (password.length < 8 || password.length > 128 || !/\p{L}/u.test(password) || !/\d/.test(password)) {
    throw new Error("كلمة المرور يجب أن تكون 8 أحرف على الأقل وتحتوي على حروف وأرقام");
  }
}

// POST /api/auth/password — set the password (first time, or after an SMS-verified reset).
export const setPassword = action({
  args: { token: v.string(), password: v.string() },
  handler: async (ctx, { token, password }): Promise<any> => {
    checkStrength(password);
    const salt = randomBytes(16).toString("hex");
    return await ctx.runMutation(internal.edge.pwStore, { token, salt, hash: derive(password, salt) });
  },
});

// POST /api/auth/password/change — signed-in user changes the password by confirming the current one.
export const changePassword = action({
  args: { token: v.string(), current: v.string(), password: v.string() },
  handler: async (ctx, { token, current, password }): Promise<any> => {
    checkStrength(password);
    const rec: any = await ctx.runQuery(internal.edge.pwRecordByToken, { token });
    if (!rec) throw new Error("لا توجد كلمة مرور حالية لهذا الحساب");
    if (rec.locked_until_ms > Date.now()) throw new Error("محاولات خاطئة كثيرة، حاول لاحقاً");
    const ok = !!current && current.length <= 128 && timingSafeEqual(Buffer.from(derive(current, rec.salt), "hex"), Buffer.from(rec.hash, "hex"));
    if (!ok) {
      const r: any = await ctx.runMutation(internal.edge.pwFail, { user_id: rec.user_id });
      throw new Error(r.error);
    }
    if (current === password) throw new Error("كلمة المرور الجديدة يجب أن تختلف عن الحالية");
    const salt = randomBytes(16).toString("hex");
    return await ctx.runMutation(internal.edge.pwStore, { token, salt, hash: derive(password, salt), verified: true });
  },
});
