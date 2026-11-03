// Unit checks of billing.ts expiry reminders (extracted from source, no network, no Convex)
const fs = require("fs");
const assert = require("assert");
const src = fs.readFileSync("/app/frontend/convex/billing.ts", "utf8");
let pass = 0, fail = 0;
const t = async (name, f) => { try { await f(); pass++; console.log("PASS", name); } catch (e) { fail++; console.log("FAIL", name, e.message); } };

// --- expiryReminderPlan
const m = src.match(/function expiryReminderPlan\(o: any, reminderDays: number\) \{[\s\S]*?\n\}/);
const plan = new Function("return " + m[0].replace("o: any, reminderDays: number", "o, reminderDays"))();
const at = (h) => new Date(Date.now() + h * 3600000).toISOString();
const base = { plan: "LICENSE", owner_id: "u1", status: "ACTIVE" };

// --- billingSettings reminder_days clamp
const clampLine = src.match(/reminder_days: (Math\.min\(.*\)),\n/)[1];
const clamp = (x) => new Function("d", "return " + clampLine)({ reminder_days: x });

// --- sendExpiryReminders handler (TS annotations stripped)
const hm = src.match(/export const sendExpiryReminders = internalAction\(\{[\s\S]*?handler: (async \(ctx\)[\s\S]*?\n  \}),\n\}\);/);
const hsrc = hm[1].replace(/: Promise<\{ total: number; sms: number \}>/, "").replace(/const list: ExpiryItem\[\]/, "const list");
const mkHandler = (sendSms) => new Function("sendSms", "internal", "console", "return " + hsrc)(sendSms, { billing: { expiryReminderBatch: "Q", markExpiryReminded: "M" } }, { error: () => {} });

(async () => {
  await t("stages fire at 7/3/1/0/-1 only", () => {
    const fired = [8, 7, 6, 5, 4, 3, 2, 1, 0, -1, -2, -3].filter((d) => plan({ ...base, expires_at: at(d * 24 - 1.5) }, 7)).map(String);
    assert.deepStrictEqual(fired, ["7", "3", "1", "0", "-1"]);
  });
  await t("left 0 and -1 share key stage 0", () => {
    const e = at(-12);
    assert.strictEqual(plan({ ...base, expires_at: e }, 7).stage, "0");
  });
  await t("SUSPENDED org skipped", () => assert.strictEqual(plan({ ...base, status: "SUSPENDED", expires_at: at(24) }, 7), null));
  await t("TRIAL skipped", () => assert.strictEqual(plan({ ...base, plan: "TRIAL", expires_at: at(24) }, 7), null));
  await t("no owner skipped", () => assert.strictEqual(plan({ plan: "LICENSE", expires_at: at(24) }, 7), null));
  await t("dedup + reset after renewal", () => {
    const e = at(2 * 24 + 1);
    const r = plan({ ...base, expires_at: e }, 7);
    assert.ok(r);
    assert.strictEqual(plan({ ...base, expires_at: e, expiry_reminders: [r.key] }, 7), null);
    assert.ok(plan({ ...base, expires_at: at(2 * 24 + 2), expiry_reminders: [r.key] }, 7));
  });
  await t("garbage date -> null", () => assert.strictEqual(plan({ ...base, expires_at: "garbage" }, 7), null));
  await t("reminder_days clamp", () => {
    assert.strictEqual(clamp(undefined), 7);
    assert.strictEqual(clamp(5.5), 6);
    assert.strictEqual(clamp(5.4), 5);
    assert.strictEqual(clamp(100), 30);
    assert.strictEqual(clamp(-4), 1);
    assert.strictEqual(clamp("abc"), 7);
    assert.strictEqual(clamp(NaN), 7);
    assert.ok(Number.isInteger(clamp(2.7)));
  });
  await t("clamped 6 fires at 6 days", () => assert.ok(plan({ ...base, expires_at: at(6 * 24 - 1) }, clamp(5.5))));

  const items = [
    { org: "o1", owner_id: "u1", key: "k1", title: "T", body: "B", phone: "+963900000001", text: "x" },
    { org: "o2", owner_id: "u2", key: "k2", title: "T", body: "B", phone: "+963900000002", text: "x" },
    { org: "o3", owner_id: "u3", key: "k3", title: "T", body: "B", phone: null, text: "x" },
    { org: "o4", owner_id: "u4", key: "k4", title: "T", body: "B", phone: "+963900000004", text: "x" },
  ];
  await t("action: throw/fail per item isolated, mark after send", async () => {
    const log = [];
    const sendSms = async (p) => { log.push("sms:" + p); if (p.endsWith("2")) throw new Error("boom"); return { ok: !p.endsWith("4") }; };
    const ctx = { runQuery: async (q) => { assert.strictEqual(q, "Q"); return items; }, runMutation: async (mm, a) => { assert.strictEqual(mm, "M"); log.push("mark:" + a.org); assert.deepStrictEqual(Object.keys(a).sort(), ["body", "key", "org", "owner_id", "title"]); } };
    const res = await mkHandler(sendSms)(ctx);
    assert.deepStrictEqual(res, { total: 4, sms: 1 });
    assert.deepStrictEqual(log, ["sms:+963900000001", "mark:o1", "sms:+963900000002", "mark:o2", "mark:o3", "sms:+963900000004", "mark:o4"]);
  });
  await t("action: empty batch", async () => {
    const res = await mkHandler(async () => { throw new Error("no"); })({ runQuery: async () => [], runMutation: async () => { throw new Error("no"); } });
    assert.deepStrictEqual(res, { total: 0, sms: 0 });
  });
  await t("sms text format", () => {
    assert.ok(src.includes("text: `النظام الذكي: ${when}. جدّد: ${renewLink()}`"));
    assert.ok(src.includes("const renewLink = () => `${process.env.CONVEX_SITE_URL}/renew`"));
  });
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
