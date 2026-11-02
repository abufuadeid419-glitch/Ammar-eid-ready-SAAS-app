// Subscriptions & payments: developer-controlled plans (draft → publish), payment methods + QR codes,
// owner payment requests with private receipts, developer verification and atomic activation.
import { v } from "convex/values";

import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import {
  DEV, MODULES, OWNER, PLAN_FIELDS, PLAN_TIERS, audit, clean, cleanAll, cleanModules, getUser, isExpired, isPro, newId, notify, nowIso,
  orgById, orgLimits, periodPrice, pubOf, require, snapshotPlan,
} from "./lib";

const OPEN = ["PENDING", "UNDER_REVIEW", "NEEDS_INFO"];
const MAX_RECEIPT_CAP_MB = 6;

// ---------------- settings ----------------
async function billingSettings(ctx: any) {
  const s: any = await ctx.db.query("app_settings").withIndex("by_key", (q: any) => q.eq("key", "billing")).unique();
  const d = s?.data ?? {};
  return {
    max_receipt_mb: Math.min(Math.max(Number(d.max_receipt_mb ?? 4), 1), MAX_RECEIPT_CAP_MB),
    allow_resubmit: d.allow_resubmit !== false,
    max_requests_per_day: Math.max(Number(d.max_requests_per_day ?? 5), 1),
    reminder_days: Number(d.reminder_days ?? 7),
  };
}

export const settingsGet = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    await getUser(ctx, token);
    return await billingSettings(ctx);
  },
});

export const devSettingsSave = mutation({
  args: { token: v.string(), max_receipt_mb: v.optional(v.number()), allow_resubmit: v.optional(v.boolean()), max_requests_per_day: v.optional(v.number()), reminder_days: v.optional(v.number()) },
  handler: async (ctx, { token, ...d }) => {
    const user = await require(ctx, token, DEV);
    const ex: any = await ctx.db.query("app_settings").withIndex("by_key", (q) => q.eq("key", "billing")).unique();
    const data = { ...(ex?.data ?? {}), ...Object.fromEntries(Object.entries(d).filter(([, x]) => x !== undefined)) };
    if (ex) await ctx.db.patch(ex._id, { data });
    else await ctx.db.insert("app_settings", { key: "billing", data });
    await audit(ctx, user, "billing_settings.update", { before: ex?.data ?? null, after: data });
    return await billingSettings(ctx);
  },
});

// ---------------- plans ----------------
// Owners: published plans only, ordered by the developer's display order.
export const plansList = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const user = await getUser(ctx, token);
    const rows: any[] = await ctx.db.query("plans").collect();
    if (user.role === "DEVELOPER") {
      return rows
        .map((p) => ({ ...clean(p), live: pubOf(p) }))
        .sort((a, b) => (a.sort_order ?? 99) - (b.sort_order ?? 99) || (a.price ?? 0) - (b.price ?? 0));
    }
    return rows
      .map(pubOf)
      .filter(Boolean)
      .sort((a: any, b: any) => (a.sort_order ?? 99) - (b.sort_order ?? 99) || (a.price ?? 0) - (b.price ?? 0));
  },
});

const planArgs = {
  token: v.string(), name: v.string(), description: v.optional(v.string()), tier: v.optional(v.string()),
  price: v.number(), yearly_price: v.optional(v.union(v.number(), v.null())), promo_price: v.optional(v.union(v.number(), v.null())),
  promo_until: v.optional(v.union(v.string(), v.null())), currency: v.optional(v.string()), days: v.optional(v.number()),
  trial_days: v.optional(v.number()), grace_days: v.optional(v.number()), max_employees: v.optional(v.number()),
  max_distributors: v.optional(v.union(v.number(), v.null())), max_customers: v.optional(v.union(v.number(), v.null())),
  modules: v.optional(v.array(v.string())), features: v.optional(v.any()), active: v.optional(v.boolean()),
  recommended: v.optional(v.boolean()), sort_order: v.optional(v.number()),
};
const nn = (x: any) => (x == null || x === "" ? null : Math.max(0, Math.floor(Number(x))));
function planBody(a: any) {
  if (!a.name.trim()) throw new Error("أدخل اسم الخطة");
  const tier = a.tier ?? "PRO";
  if (!PLAN_TIERS.includes(tier)) throw new Error("فئة الخطة غير صالحة");
  for (const p of [a.price, a.yearly_price, a.promo_price]) if (p != null && (!(p >= 0) || p > 1e9)) throw new Error("السعر غير صالح");
  if (a.promo_until && isNaN(Date.parse(a.promo_until))) throw new Error("تاريخ انتهاء العرض غير صالح");
  const max_employees = Math.max(1, Math.floor(a.max_employees ?? 5));
  const md = nn(a.max_distributors);
  return {
    name: a.name.trim().slice(0, 60), description: (a.description ?? "").slice(0, 400), tier,
    price: tier === "FREE" ? 0 : a.price, yearly_price: tier === "FREE" ? null : a.yearly_price ?? null,
    promo_price: a.promo_price ?? null, promo_until: a.promo_until || null, currency: (a.currency || "USD").toUpperCase().slice(0, 6),
    days: Math.max(1, Math.floor(a.days ?? 30)), trial_days: Math.max(0, Math.floor(a.trial_days ?? 0)), grace_days: Math.max(0, Math.min(60, Math.floor(a.grace_days ?? 0))),
    max_employees, max_distributors: md == null ? null : Math.min(md, max_employees), max_customers: nn(a.max_customers),
    modules: cleanModules(a.modules) ?? MODULES, features: Array.isArray(a.features) ? a.features.slice(0, 20).map((f: any) => String(f).slice(0, 120)) : [],
    active: a.active ?? true, recommended: !!a.recommended, sort_order: Math.floor(a.sort_order ?? 10),
  };
}

// Create/edit only change the DRAFT; owners keep seeing the published snapshot until "publish".
export const devPlanCreate = mutation({
  args: planArgs,
  handler: async (ctx, a) => {
    const user = await require(ctx, a.token, DEV);
    const doc = { id: newId(), ...planBody(a), status: "draft", published: null, version: 0, created_at: nowIso(), updated_at: nowIso() };
    await ctx.db.insert("plans", doc);
    await audit(ctx, user, "plan.create", { target: doc.id, after: snapshotPlan(doc) });
    return doc;
  },
});

export const devPlanUpdate = mutation({
  args: { ...planArgs, id: v.string() },
  handler: async (ctx, a) => {
    const user = await require(ctx, a.token, DEV);
    const p: any = await ctx.db.query("plans").withIndex("by_biz_id", (q) => q.eq("id", a.id)).unique();
    if (!p) throw new Error("الخطة غير موجودة");
    const live = pubOf(p);
    const body = planBody(a);
    // Legacy plan (no status): freeze its current values as the published version first.
    const extra = !p.status ? { published: snapshotPlan(p), version: 1 } : {};
    await ctx.db.patch(p._id, { ...body, ...extra, status: p.status === "archived" ? "archived" : live || extra.published ? "changed" : "draft", updated_at: nowIso() });
    await audit(ctx, user, "plan.update_draft", { target: p.id, before: snapshotPlan(p), after: body });
    return clean(await ctx.db.get(p._id));
  },
});

export const devPlanPublish = mutation({
  args: { token: v.string(), id: v.string() },
  handler: async (ctx, { token, id }) => {
    const user = await require(ctx, token, DEV);
    const p: any = await ctx.db.query("plans").withIndex("by_biz_id", (q) => q.eq("id", id)).unique();
    if (!p || p.status === "archived") throw new Error("الخطة غير موجودة");
    const snap = snapshotPlan(p);
    if (snap.tier === "FREE") {
      const otherFree = (await ctx.db.query("plans").collect()).find((x: any) => x.id !== id && pubOf(x)?.tier === "FREE");
      if (otherFree) throw new Error("توجد خطة مجانية منشورة بالفعل — أرشفها أولاً");
    }
    const version = (p.version ?? 0) + 1;
    await ctx.db.patch(p._id, { published: snap, status: "published", version, updated_at: nowIso() });
    await ctx.db.insert("plan_versions", { plan_id: id, version, snapshot: snap, published_by: user.user_id, published_at: nowIso() });
    await audit(ctx, user, "plan.publish", { target: id, before: p.published ?? null, after: snap, note: `v${version}` });
    return { ok: true, version };
  },
});

export const devPlanArchive = mutation({
  args: { token: v.string(), id: v.string(), restore: v.optional(v.boolean()) },
  handler: async (ctx, { token, id, restore }) => {
    const user = await require(ctx, token, DEV);
    const p: any = await ctx.db.query("plans").withIndex("by_biz_id", (q) => q.eq("id", id)).unique();
    if (!p) throw new Error("الخطة غير موجودة");
    // Archiving hides the plan for new purchases; existing subscriptions keep their terms.
    await ctx.db.patch(p._id, { status: restore ? (p.published ? "published" : "draft") : "archived", updated_at: nowIso() });
    await audit(ctx, user, restore ? "plan.unarchive" : "plan.archive", { target: id });
    return { ok: true };
  },
});

export const devPlanVersions = query({
  args: { token: v.string(), id: v.string() },
  handler: async (ctx, { token, id }) => {
    await require(ctx, token, DEV);
    const rows = await ctx.db.query("plan_versions").withIndex("by_plan", (q) => q.eq("plan_id", id)).order("desc").take(20);
    return rows.map((r) => ({ version: r.version, snapshot: r.snapshot, published_at: r.published_at }));
  },
});

// Restore a previous published version into the draft (publish again to make it live).
export const devPlanRestore = mutation({
  args: { token: v.string(), id: v.string(), version: v.number() },
  handler: async (ctx, { token, id, version }) => {
    const user = await require(ctx, token, DEV);
    const p: any = await ctx.db.query("plans").withIndex("by_biz_id", (q) => q.eq("id", id)).unique();
    const ver = await ctx.db.query("plan_versions").withIndex("by_plan", (q) => q.eq("plan_id", id).eq("version", version)).unique();
    if (!p || !ver) throw new Error("الإصدار غير موجود");
    // Exact restore: fields empty in that version are cleared too. Archived plans stay archived.
    const snap = Object.fromEntries(PLAN_FIELDS.map((k) => [k, ver.snapshot[k] ?? undefined]));
    await ctx.db.patch(p._id, { ...snap, status: p.status === "archived" ? "archived" : "changed", updated_at: nowIso() });
    await audit(ctx, user, "plan.restore_draft", { target: id, note: `v${version}` });
    return { ok: true };
  },
});

// ---------------- payment methods + QR ----------------
async function qrUrl(ctx: any, m: any) {
  return m.qr_storage ? await ctx.storage.getUrl(m.qr_storage) : null;
}

export const methodsList = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const user = await getUser(ctx, token);
    const all: any[] = (await ctx.db.query("payment_methods").collect()).filter((m) => !m.archived);
    const rows = user.role === "DEVELOPER" ? all : all.filter((m) => m.active && (!m.org_ids?.length || m.org_ids.includes(user.org_id)));
    rows.sort((a, b) => (a.sort_order ?? 99) - (b.sort_order ?? 99));
    const out = [];
    for (const m of rows) {
      const c: any = clean(m);
      delete c.qr_storage;
      if (user.role !== "DEVELOPER") delete c.org_ids;
      out.push({ ...c, qr_url: await qrUrl(ctx, m) });
    }
    return out;
  },
});

export const devMethodSave = mutation({
  args: {
    token: v.string(), id: v.optional(v.string()), name: v.string(), kind: v.optional(v.string()), description: v.optional(v.string()),
    recipient: v.optional(v.string()), account: v.optional(v.string()), currency: v.optional(v.string()), instructions: v.optional(v.string()),
    require_reference: v.optional(v.boolean()), require_receipt: v.optional(v.boolean()), min_amount: v.optional(v.union(v.number(), v.null())),
    max_amount: v.optional(v.union(v.number(), v.null())), plan_ids: v.optional(v.array(v.string())), org_ids: v.optional(v.array(v.string())),
    active: v.optional(v.boolean()), sort_order: v.optional(v.number()),
  },
  handler: async (ctx, { token, id, ...a }) => {
    const user = await require(ctx, token, DEV);
    if (!a.name.trim()) throw new Error("أدخل اسم طريقة الدفع");
    if (a.kind && !["bank", "wallet", "cash", "other"].includes(a.kind)) throw new Error("نوع غير صالح");
    if (a.min_amount != null && a.max_amount != null && a.min_amount > a.max_amount) throw new Error("الحد الأدنى أكبر من الأعلى");
    const body = {
      name: a.name.trim().slice(0, 60), kind: a.kind ?? "bank", description: (a.description ?? "").slice(0, 300), recipient: (a.recipient ?? "").slice(0, 120),
      account: (a.account ?? "").slice(0, 200), currency: (a.currency ?? "").toUpperCase().slice(0, 6), instructions: (a.instructions ?? "").slice(0, 1500),
      require_reference: a.require_reference ?? true, require_receipt: a.require_receipt ?? true, min_amount: a.min_amount ?? null, max_amount: a.max_amount ?? null,
      plan_ids: a.plan_ids ?? [], org_ids: a.org_ids ?? [], active: a.active ?? true, sort_order: Math.floor(a.sort_order ?? 10), updated_at: nowIso(),
    };
    if (id) {
      const m: any = await ctx.db.query("payment_methods").withIndex("by_biz_id", (q) => q.eq("id", id)).unique();
      if (!m) throw new Error("غير موجود");
      await ctx.db.patch(m._id, body);
      await audit(ctx, user, "payment_method.update", { target: id, before: { ...clean(m), qr_storage: undefined }, after: body });
      return { id };
    }
    const nid = newId();
    await ctx.db.insert("payment_methods", { id: nid, ...body, qr_storage: null, created_at: nowIso() });
    await audit(ctx, user, "payment_method.create", { target: nid, after: body });
    return { id: nid };
  },
});

export const devMethodArchive = mutation({
  args: { token: v.string(), id: v.string() },
  handler: async (ctx, { token, id }) => {
    const user = await require(ctx, token, DEV);
    const m: any = await ctx.db.query("payment_methods").withIndex("by_biz_id", (q) => q.eq("id", id)).unique();
    if (!m) throw new Error("غير موجود");
    await ctx.db.patch(m._id, { archived: true, active: false });
    await audit(ctx, user, "payment_method.archive", { target: id });
    return { ok: true };
  },
});

export const setMethodQr = internalMutation({
  args: { token: v.string(), id: v.string(), storageId: v.union(v.string(), v.null()), content_type: v.optional(v.string()) },
  handler: async (ctx, { token, id, storageId, content_type }) => {
    const user = await require(ctx, token, DEV);
    const m: any = await ctx.db.query("payment_methods").withIndex("by_biz_id", (q) => q.eq("id", id)).unique();
    if (!m) throw new Error("غير موجود");
    if (m.qr_storage) await ctx.storage.delete(m.qr_storage);
    await ctx.db.patch(m._id, { qr_storage: storageId, qr_type: content_type ?? "", updated_at: nowIso() });
    await audit(ctx, user, storageId ? "payment_method.qr_replace" : "payment_method.qr_remove", { target: id });
    return { ok: true };
  },
});

// ---------------- file validation (magic bytes, never trust extension / client MIME) ----------------
function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.split(",").pop() as string);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function sniff(b: Uint8Array): string | null {
  const s = (i: number, n: number) => String.fromCharCode(...b.slice(i, i + n));
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && s(1, 3) === "PNG") return "image/png";
  if (s(0, 4) === "RIFF" && s(8, 4) === "WEBP") return "image/webp";
  if (s(0, 5) === "%PDF-") return "application/pdf";
  return null;
}
function validateFile(data: string, maxMb: number, allowPdf: boolean) {
  let bytes: Uint8Array;
  try {
    bytes = b64ToBytes(data);
  } catch {
    throw new Error("ملف غير صالح");
  }
  if (bytes.length < 100) throw new Error("ملف غير صالح");
  if (bytes.length > maxMb * 1024 * 1024) throw new Error(`حجم الملف أكبر من ${maxMb}MB`);
  const type = sniff(bytes);
  if (!type || (type === "application/pdf" && !allowPdf)) throw new Error(allowPdf ? "الصيغ المسموحة: JPG, PNG, WebP, PDF" : "الصيغ المسموحة: JPG, PNG, WebP");
  if (type === "application/pdf") {
    // Quarantine PDFs carrying active content (scripts, auto-actions, embedded files).
    const txt = new TextDecoder("latin1").decode(bytes);
    if (/\/(JavaScript|JS|Launch|OpenAction|AA|EmbeddedFile|RichMedia|XFA)\b/.test(txt)) throw new Error("ملف PDF يحتوي محتوى نشطاً غير مسموح");
  }
  return { bytes, type };
}

export const devMethodUploadQr = action({
  args: { token: v.string(), id: v.string(), data: v.optional(v.string()) },
  handler: async (ctx, { token, id, data }): Promise<any> => {
    if (!data) return await ctx.runMutation(internal.billing.setMethodQr, { token, id, storageId: null });
    const f = validateFile(data, 2, false);
    const storageId = await ctx.storage.store(new Blob([f.bytes as any], { type: f.type }));
    try {
      return await ctx.runMutation(internal.billing.setMethodQr, { token, id, storageId, content_type: f.type });
    } catch (e) {
      await ctx.storage.delete(storageId);
      throw e;
    }
  },
});

// ---------------- owner payment requests ----------------
const reqOut = (r: any, dev: boolean) => {
  const c: any = clean(r);
  c.has_receipt = !!r.receipt_storage;
  delete c.receipt_storage;
  delete c.idem_key;
  if (!dev) delete c.reviewer_id;
  return c;
};

export const requestsList = query({
  args: { token: v.string(), status: v.optional(v.string()), org_id: v.optional(v.string()) },
  handler: async (ctx, { token, status, org_id }) => {
    const user = await getUser(ctx, token);
    let rows: any[];
    if (user.role === "DEVELOPER") {
      rows = org_id
        ? await ctx.db.query("upgrade_requests").withIndex("by_org", (q) => q.eq("org_id", org_id)).collect()
        : status
          ? await ctx.db.query("upgrade_requests").withIndex("by_status", (q) => q.eq("status", status)).collect()
          : await ctx.db.query("upgrade_requests").order("desc").take(200);
    } else if (user.role === "OWNER") {
      // Owner org comes from the session, never from the client.
      rows = await ctx.db.query("upgrade_requests").withIndex("by_org", (q) => q.eq("org_id", user.org_id!)).collect();
    } else throw new Error("ليس لديك صلاحية");
    if (status) rows = rows.filter((r) => r.status === status);
    rows.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    return rows.map((r) => reqOut(r, user.role === "DEVELOPER"));
  },
});

export const createRequest = internalMutation({
  args: {
    token: v.string(), plan_id: v.string(), billing: v.string(), method_id: v.string(), amount: v.number(), payment_ref: v.string(),
    notes: v.optional(v.string()), idem_key: v.string(), storageId: v.union(v.string(), v.null()), receipt_type: v.optional(v.string()), receipt_size: v.optional(v.number()),
  },
  handler: async (ctx, a): Promise<any> => {
    const user = await require(ctx, a.token, OWNER);
    const mine = await ctx.db.query("upgrade_requests").withIndex("by_org", (q) => q.eq("org_id", user.org_id!)).collect();
    // Idempotency: retries / double taps with the same key return the first request.
    const dup = mine.find((r) => r.idem_key === a.idem_key);
    if (dup) return { ...reqOut(dup, false), duplicate: true };
    if (mine.some((r) => OPEN.includes(r.status ?? ""))) throw new Error("لديك طلب دفع مفتوح بالفعل — انتظر المراجعة أو ألغِه");
    const st = await billingSettings(ctx);
    const dayAgo = Date.now() - 86400000;
    if (mine.filter((r) => Date.parse(r.created_at ?? "") > dayAgo).length >= st.max_requests_per_day) throw new Error("تجاوزت عدد الطلبات المسموح يومياً");
    const planDoc: any = await ctx.db.query("plans").withIndex("by_biz_id", (q) => q.eq("id", a.plan_id)).unique();
    const plan: any = pubOf(planDoc);
    if (!plan) throw new Error("الخطة غير متاحة");
    if (plan.tier === "FREE") throw new Error("الخطة المجانية لا تحتاج إلى دفع");
    const period = periodPrice(plan, a.billing);
    if (!period) throw new Error("فترة الفوترة غير متاحة لهذه الخطة");
    const m: any = await ctx.db.query("payment_methods").withIndex("by_biz_id", (q) => q.eq("id", a.method_id)).unique();
    if (!m || !m.active || m.archived) throw new Error("طريقة الدفع غير متاحة");
    if (m.plan_ids?.length && !m.plan_ids.includes(plan.id)) throw new Error("طريقة الدفع غير متاحة لهذه الخطة");
    if (m.org_ids?.length && !m.org_ids.includes(user.org_id)) throw new Error("طريقة الدفع غير متاحة");
    if (m.currency && plan.currency && m.currency !== plan.currency) throw new Error("عملة طريقة الدفع لا تطابق عملة الخطة");
    if (!(a.amount > 0) || a.amount > 1e9) throw new Error("أدخل المبلغ المحوَّل");
    if (m.min_amount != null && a.amount < m.min_amount) throw new Error(`الحد الأدنى لهذه الطريقة ${m.min_amount}`);
    if (m.max_amount != null && a.amount > m.max_amount) throw new Error(`الحد الأعلى لهذه الطريقة ${m.max_amount}`);
    const ref = a.payment_ref.trim().slice(0, 80);
    if (m.require_reference !== false && !ref) throw new Error("أدخل رقم/مرجع عملية التحويل");
    if (m.require_receipt !== false && !a.storageId) throw new Error("أرفق صورة أو ملف PDF لإيصال التحويل");
    const org: any = await orgById(ctx, user.org_id!);
    const now = nowIso();
    // Price/limits are frozen into the request: later plan edits never change it.
    const doc = {
      id: newId(), ref_code: `PAY-${now.slice(2, 10).replace(/-/g, "")}-${newId().slice(0, 5).toUpperCase()}`, idem_key: a.idem_key,
      org_id: org.id, org_name: org.name, owner_id: user.user_id, owner_email: user.phone ?? user.email, plan_id: plan.id,
      plan_name: plan.name + (a.billing === "yearly" ? " (سنوي)" : ""), billing: a.billing === "yearly" ? "yearly" : "monthly",
      price: period.price, currency: plan.currency, days: period.days, grace_days: plan.grace_days ?? 0, tier: plan.tier,
      modules: plan.modules ?? MODULES, max_employees: plan.max_employees, max_distributors: plan.max_distributors ?? null, max_customers: plan.max_customers ?? null,
      method_id: m.id, method_name: m.name, amount: a.amount, amount_mismatch: Math.abs(a.amount - period.price) > 0.009,
      payment_ref: ref, notes: (a.notes ?? "").slice(0, 500), receipt_storage: a.storageId, receipt_type: a.receipt_type, receipt_size: a.receipt_size,
      status: "PENDING", history: [{ status: "PENDING", by: "owner", at: now }], created_at: now,
    };
    await ctx.db.insert("upgrade_requests", doc);
    await audit(ctx, user, "payment.submit", { org_id: org.id, target: doc.id, after: { plan: doc.plan_name, price: doc.price, amount: doc.amount, currency: doc.currency, method: m.name } });
    await notify(ctx, [user.user_id], "upgrade", "تم استلام طلب الدفع", `${doc.ref_code} · قيد التحقق. لن يتم التفعيل قبل مراجعة المطور.`);
    const devs = (await ctx.db.query("users").collect()).filter((u: any) => u.role === "DEVELOPER").map((u: any) => u.user_id);
    await notify(ctx, devs, "upgrade", "طلب دفع بحاجة للمراجعة", `${org.name} · ${doc.plan_name} · ${doc.ref_code}`);
    return reqOut(doc, false);
  },
});

// POST /api/upgrade-requests — validates + stores the receipt privately, then creates the request atomically.
export const submitPayment = action({
  args: {
    token: v.string(), plan_id: v.string(), billing: v.optional(v.string()), method_id: v.string(), amount: v.number(), payment_ref: v.optional(v.string()),
    notes: v.optional(v.string()), idem_key: v.string(), receipt: v.optional(v.string()),
  },
  handler: async (ctx, a): Promise<any> => {
    if (!/^[A-Za-z0-9-]{8,64}$/.test(a.idem_key)) throw new Error("طلب غير صالح");
    const st: any = await ctx.runQuery(internal.billing.settingsInternal, {});
    let storageId: string | null = null;
    let f: any = null;
    if (a.receipt) {
      f = validateFile(a.receipt, st.max_receipt_mb, true);
      storageId = await ctx.storage.store(new Blob([f.bytes], { type: f.type }));
    }
    try {
      const r = await ctx.runMutation(internal.billing.createRequest, {
        token: a.token, plan_id: a.plan_id, billing: a.billing ?? "monthly", method_id: a.method_id, amount: a.amount, payment_ref: a.payment_ref ?? "",
        notes: a.notes, idem_key: a.idem_key, storageId, receipt_type: f?.type, receipt_size: f?.bytes.length,
      });
      if (r.duplicate && storageId) await ctx.storage.delete(storageId);
      return r;
    } catch (e) {
      if (storageId) await ctx.storage.delete(storageId);
      throw e;
    }
  },
});

export const settingsInternal = internalQuery({ args: {}, handler: async (ctx) => await billingSettings(ctx) });

export const replaceReceipt = internalMutation({
  args: { token: v.string(), id: v.string(), storageId: v.string(), receipt_type: v.string(), receipt_size: v.number(), payment_ref: v.optional(v.string()), amount: v.optional(v.number()) },
  handler: async (ctx, a) => {
    const user = await require(ctx, a.token, OWNER);
    const r: any = await ctx.db.query("upgrade_requests").withIndex("by_biz_id", (q) => q.eq("id", a.id)).unique();
    if (!r || r.org_id !== user.org_id) throw new Error("الطلب غير موجود");
    const st = await billingSettings(ctx);
    const can = r.status === "NEEDS_INFO" || r.status === "PENDING" || (r.status === "REJECTED" && st.allow_resubmit);
    if (!can) throw new Error("لا يمكن تعديل هذا الطلب");
    if (r.receipt_storage) await ctx.storage.delete(r.receipt_storage);
    const amount = a.amount != null && a.amount > 0 ? a.amount : r.amount;
    const history = [...(r.history ?? []), { status: "PENDING", by: "owner", at: nowIso(), note: "إعادة إرسال الإيصال" }];
    await ctx.db.patch(r._id, {
      receipt_storage: a.storageId, receipt_type: a.receipt_type, receipt_size: a.receipt_size, status: "PENDING", history, amount,
      amount_mismatch: Math.abs((amount ?? 0) - (r.price ?? 0)) > 0.009, ...(a.payment_ref?.trim() ? { payment_ref: a.payment_ref.trim().slice(0, 80) } : {}),
    });
    await audit(ctx, user, "payment.receipt_replace", { org_id: r.org_id, target: r.id });
    const devs = (await ctx.db.query("users").collect()).filter((u: any) => u.role === "DEVELOPER").map((u: any) => u.user_id);
    await notify(ctx, devs, "upgrade", "تم إعادة إرسال إيصال", `${r.org_name} · ${r.ref_code ?? r.id}`);
    return { ok: true };
  },
});

export const resubmitReceipt = action({
  args: { token: v.string(), id: v.string(), receipt: v.string(), payment_ref: v.optional(v.string()), amount: v.optional(v.number()) },
  handler: async (ctx, a): Promise<any> => {
    const st: any = await ctx.runQuery(internal.billing.settingsInternal, {});
    const f = validateFile(a.receipt, st.max_receipt_mb, true);
    const storageId = await ctx.storage.store(new Blob([f.bytes as any], { type: f.type }));
    try {
      return await ctx.runMutation(internal.billing.replaceReceipt, { token: a.token, id: a.id, storageId, receipt_type: f.type, receipt_size: f.bytes.length, payment_ref: a.payment_ref, amount: a.amount });
    } catch (e) {
      await ctx.storage.delete(storageId);
      throw e;
    }
  },
});

export const cancelRequest = mutation({
  args: { token: v.string(), id: v.string() },
  handler: async (ctx, { token, id }) => {
    const user = await require(ctx, token, OWNER);
    const r: any = await ctx.db.query("upgrade_requests").withIndex("by_biz_id", (q) => q.eq("id", id)).unique();
    if (!r || r.org_id !== user.org_id) throw new Error("الطلب غير موجود");
    if (!OPEN.includes(r.status)) throw new Error("لا يمكن إلغاء هذا الطلب");
    await ctx.db.patch(r._id, { status: "CANCELLED", history: [...(r.history ?? []), { status: "CANCELLED", by: "owner", at: nowIso() }] });
    await audit(ctx, user, "payment.cancel", { org_id: r.org_id, target: id });
    return { ok: true };
  },
});

// Authenticated receipt download: owner of the same org or developer only. Returns a data URI (no public URL).
export const receiptAccess = internalQuery({
  args: { token: v.string(), id: v.string() },
  handler: async (ctx, { token, id }) => {
    const user = await getUser(ctx, token);
    const r: any = await ctx.db.query("upgrade_requests").withIndex("by_biz_id", (q) => q.eq("id", id)).unique();
    if (!r) throw new Error("غير موجود");
    const ok = user.role === "DEVELOPER" || (user.role === "OWNER" && user.org_id === r.org_id);
    if (!ok) throw new Error("غير موجود");
    return { storage: r.receipt_storage ?? null, type: r.receipt_type ?? "application/octet-stream" };
  },
});

export const getReceipt = action({
  args: { token: v.string(), id: v.string() },
  handler: async (ctx, { token, id }): Promise<any> => {
    const info: any = await ctx.runQuery(internal.billing.receiptAccess, { token, id });
    if (!info.storage) return { data_uri: null };
    const blob = await ctx.storage.get(info.storage);
    if (!blob) return { data_uri: null };
    const buf = new Uint8Array(await blob.arrayBuffer());
    let bin = "";
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return { data_uri: `data:${info.type};base64,${btoa(bin)}`, type: info.type };
  },
});

// ---------------- developer verification + atomic activation ----------------
export const devReview = mutation({
  args: { token: v.string(), id: v.string(), action: v.string(), note: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const user = await require(ctx, a.token, DEV);
    const r: any = await ctx.db.query("upgrade_requests").withIndex("by_biz_id", (q) => q.eq("id", a.id)).unique();
    if (!r) throw new Error("الطلب غير موجود");
    const note = (a.note ?? "").trim().slice(0, 500);
    const from = r.status === "PENDING" && !r.history ? "PENDING" : r.status;
    const T: Record<string, [string[], string]> = {
      under_review: [["PENDING"], "UNDER_REVIEW"],
      needs_info: [["PENDING", "UNDER_REVIEW"], "NEEDS_INFO"],
      approve: [["PENDING", "UNDER_REVIEW"], "APPROVED"],
      reject: [["PENDING", "UNDER_REVIEW", "NEEDS_INFO"], "REJECTED"],
      cancel: [["PENDING", "UNDER_REVIEW", "NEEDS_INFO"], "CANCELLED"],
      refund: [["APPROVED"], "REFUNDED"],
    };
    const t = T[a.action];
    if (!t) throw new Error("إجراء غير صالح");
    // Transition guard = idempotency: an APPROVED request can never be approved (or extend) again.
    if (!t[0].includes(from)) throw new Error("تمت مراجعة هذا الطلب بالفعل أو لا يسمح وضعه بهذا الإجراء");
    if (["reject", "needs_info", "refund"].includes(a.action) && !note) throw new Error("اكتب السبب / الملاحظة");
    const org: any = await orgById(ctx, r.org_id);
    if (!org) throw new Error("المؤسسة غير موجودة");
    const status = t[1];
    let orgAfter: any = null;
    if (status === "APPROVED") {
      // Renewal of the same plan extends from the current end; a new/changed plan starts now.
      const renew = org.plan === "LICENSE" && org.plan_id === r.plan_id && !isExpired(org) && org.status === "ACTIVE";
      const base = renew ? Math.max(Date.parse(org.expires_at), Date.now()) : Date.now();
      const expires = new Date(base + (r.days ?? 30) * 86400000).toISOString();
      const grace = r.grace_days ? new Date(Date.parse(expires) + r.grace_days * 86400000).toISOString() : null;
      orgAfter = {
        plan: "LICENSE", plan_id: r.plan_id, plan_name: r.plan_name, plan_tier: r.tier ?? "PRO", modules: r.modules ?? MODULES,
        max_employees: r.max_employees, max_distributors: r.max_distributors ?? null, max_customers: r.max_customers ?? null,
        status: "ACTIVE", expires_at: expires, grace_until: grace,
      };
      await ctx.db.patch(org._id, orgAfter);
    }
    await ctx.db.patch(r._id, {
      status, review_note: note || r.review_note || "", reviewed_at: nowIso(), reviewer_id: user.user_id,
      history: [...(r.history ?? []), { status, by: "developer", at: nowIso(), note }],
    });
    await audit(ctx, user, `payment.${a.action}`, {
      org_id: r.org_id, target: r.id, note,
      before: status === "APPROVED" ? { plan: org.plan, plan_name: org.plan_name, expires_at: org.expires_at } : { status: from },
      after: status === "APPROVED" ? { plan_name: orgAfter.plan_name, expires_at: orgAfter.expires_at } : { status },
    });
    const msg: Record<string, [string, string]> = {
      UNDER_REVIEW: ["طلب الدفع قيد المراجعة", r.ref_code ?? ""],
      NEEDS_INFO: ["مطلوب معلومات إضافية لطلب الدفع", note],
      APPROVED: ["تم تأكيد الدفع وتفعيل الاشتراك", `${r.plan_name} · حتى ${orgAfter?.expires_at?.slice(0, 10) ?? ""}`],
      REJECTED: ["تم رفض طلب الدفع", note],
      CANCELLED: ["تم إلغاء طلب الدفع", note],
      REFUNDED: ["تم تسجيل استرداد المبلغ", note],
    };
    if (status === "REFUNDED") {
      // Refund is tracking only; flag it so the developer can suspend / reassign the subscription explicitly.
      await notify(ctx, [user.user_id], "upgrade", "تم تسجيل استرداد — راجع اشتراك المؤسسة", `${r.org_name} لا يزال على ${org.plan_name ?? "خطته"} حتى تغيّره يدوياً`);
    }
    // Notification is best-effort and never part of the payment decision.
    await notify(ctx, [org.owner_id], "upgrade", msg[status][0], msg[status][1]);
    return reqOut(await ctx.db.get(r._id), true);
  },
});

// Developer: assign a published plan to an organization manually (no payment), with audit.
export const devAssignPlan = mutation({
  args: { token: v.string(), org_id: v.string(), plan_id: v.string(), days: v.number(), note: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const user = await require(ctx, a.token, DEV);
    const org: any = await orgById(ctx, a.org_id);
    const plan: any = pubOf(await ctx.db.query("plans").withIndex("by_biz_id", (q) => q.eq("id", a.plan_id)).unique());
    if (!org || !plan) throw new Error("المؤسسة أو الخطة غير موجودة");
    if (!(a.days >= 1 && a.days <= 3660)) throw new Error("المدة غير صالحة");
    const after = {
      plan: plan.tier === "FREE" ? "FREE" : "LICENSE", plan_id: plan.id, plan_name: plan.name, plan_tier: plan.tier === "FREE" ? null : plan.tier,
      modules: plan.modules ?? MODULES, max_employees: plan.max_employees, max_distributors: plan.max_distributors ?? null, max_customers: plan.max_customers ?? null,
      status: "ACTIVE", expires_at: new Date(Date.now() + a.days * 86400000).toISOString(), grace_until: null,
    };
    await ctx.db.patch(org._id, after as any);
    await audit(ctx, user, "subscription.assign", { org_id: org.id, before: { plan_name: org.plan_name, expires_at: org.expires_at, status: org.status }, after, note: a.note });
    await notify(ctx, [org.owner_id], "upgrade", "تم تحديث اشتراك مؤسستك", `${plan.name} · حتى ${after.expires_at.slice(0, 10)}`);
    return { ok: true };
  },
});

// Developer: org detail = subscription, usage vs limits, requests.
export const devOrgDetail = query({
  args: { token: v.string(), id: v.string() },
  handler: async (ctx, { token, id }) => {
    await require(ctx, token, DEV);
    const org: any = await orgById(ctx, id);
    if (!org) throw new Error("غير موجود");
    const users = await ctx.db.query("users").withIndex("by_org", (q) => q.eq("org_id", id)).collect();
    const customers = (await ctx.db.query("customers").withIndex("by_org", (q) => q.eq("org_id", id)).collect()).length;
    const lim = await orgLimits(ctx, org);
    const reqs = await ctx.db.query("upgrade_requests").withIndex("by_org", (q) => q.eq("org_id", id)).collect();
    return {
      org: clean(org), active: isPro(org), limits: lim,
      usage: { employees: users.filter((u) => u.role === "EMPLOYEE").length, distributors: users.filter((u: any) => u.role === "EMPLOYEE" && u.employee_type === "FIELD_AGENT").length, customers },
      pending: reqs.filter((r) => OPEN.includes(r.status ?? "")).length,
      requests: reqs.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 10).map((r) => reqOut(r, true)),
    };
  },
});

export const devAudit = query({
  args: { token: v.string(), org_id: v.optional(v.string()), limit: v.optional(v.number()) },
  handler: async (ctx, { token, org_id, limit }) => {
    await require(ctx, token, DEV);
    const n = Math.min(Math.max(limit ?? 100, 1), 300);
    const rows = org_id
      ? await ctx.db.query("audit_logs").withIndex("by_org", (q) => q.eq("org_id", org_id)).order("desc").take(n)
      : await ctx.db.query("audit_logs").order("desc").take(n);
    return cleanAll(rows);
  },
});

export const devStats = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    await require(ctx, token, DEV);
    const reqs = await ctx.db.query("upgrade_requests").collect();
    const orgs = await ctx.db.query("organizations").collect();
    const by: Record<string, number> = {};
    for (const r of reqs) by[r.status ?? "?"] = (by[r.status ?? "?"] ?? 0) + 1;
    const revenue: Record<string, number> = {};
    for (const r of reqs) if (r.status === "APPROVED") revenue[r.currency ?? "?"] = (revenue[r.currency ?? "?"] ?? 0) + (r.price ?? 0);
    const tiers: Record<string, number> = { FREE: 0, TRIAL: 0, PRO: 0, VIP: 0 };
    let expiring = 0;
    for (const o of orgs as any[]) {
      if (o.plan === "TRIAL" && isPro(o)) tiers.TRIAL++;
      else if (o.plan === "LICENSE" && isPro(o)) tiers[o.plan_tier === "VIP" ? "VIP" : "PRO"]++;
      else tiers.FREE++;
      if (o.plan === "LICENSE" && isPro(o) && Date.parse(o.expires_at) - Date.now() < 7 * 86400000) expiring++;
    }
    return { by_status: by, revenue, tiers, expiring, open: reqs.filter((r) => OPEN.includes(r.status ?? "")).length };
  },
});

// Cron: subscription expiry reminders (N days before, 1 day before, on expiry).
export const sendExpiryReminders = internalMutation({
  args: {},
  handler: async (ctx) => {
    const st = await billingSettings(ctx);
    const day = 86400000;
    for (const o of (await ctx.db.query("organizations").collect()) as any[]) {
      if (o.plan !== "LICENSE" || !o.expires_at || !o.owner_id) continue;
      const left = Math.ceil((Date.parse(o.expires_at) - Date.now()) / day);
      if (left === st.reminder_days || left === 1) await notify(ctx, [o.owner_id], "upgrade", "اشتراكك يقترب من الانتهاء", `متبقٍ ${left} يوم على ${o.plan_name ?? "خطتك"} — جدّد من صفحة الخطط`);
      else if (left === 0) await notify(ctx, [o.owner_id], "upgrade", "انتهى اشتراكك", o.grace_until ? "لديك فترة سماح قصيرة، جدّد الآن لتجنب إيقاف الميزات" : "جدّد اشتراكك لاستعادة الميزات");
    }
  },
});
