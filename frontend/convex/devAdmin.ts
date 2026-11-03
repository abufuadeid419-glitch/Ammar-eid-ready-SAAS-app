// Developer Admin: delete / soft-delete / restore anything the developer manages, with cascading cleanup
// (no orphaned rows) and an audit trail. Every function here is DEVELOPER-only.
import { v } from "convex/values";

import { action, internalMutation, mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { DEV, audit, getUser, nowIso, orgById, require } from "./lib";

// Org-scoped tables purged on a hard delete. billing_ledger + audit_logs are kept as the financial/audit history.
const ORG_TABLES = [
  "invitations", "products", "customers", "customer_types", "sales", "collections", "sales_returns", "payment_vouchers",
  "purchases", "purchase_returns", "suppliers", "supplier_payments", "deliveries", "warehouse_returns", "distributor_inventory",
  "stock_movements", "stock_requests", "upgrade_requests", "deletion_requests", "price_history", "routes", "counters",
  "number_blocks", "agent_locations", "sales_targets",
];

async function wipeUserAuth(ctx: any, user_id: string) {
  for (const t of ["user_sessions", "user_passwords", "notifications"]) {
    const rows = await ctx.db.query(t).filter((q: any) => q.eq(q.field("user_id"), user_id)).collect();
    for (const r of rows) await ctx.db.delete(r._id);
  }
}

// One bounded batch per call (keeps every mutation small); returns how many rows were removed.
export const purgeBatch = internalMutation({
  args: { org_id: v.string(), table: v.string() },
  handler: async (ctx, { org_id, table }) => {
    const rows: any[] = await (ctx.db.query(table as any) as any).filter((q: any) => q.eq(q.field("org_id"), org_id)).take(400);
    for (const r of rows) {
      if (table === "upgrade_requests" && r.receipt_storage) await ctx.storage.delete(r.receipt_storage).catch(() => {});
      await ctx.db.delete(r._id);
    }
    return rows.length;
  },
});

// Final step of a hard delete: unlink every member account (accounts survive, org access is removed) and drop the org.
export const finishOrgDelete = internalMutation({
  args: { token: v.string(), org_id: v.string(), purged: v.any() },
  handler: async (ctx, { token, org_id, purged }) => {
    const user = await require(ctx, token, DEV);
    const org: any = await orgById(ctx, org_id);
    const members = await ctx.db.query("users").withIndex("by_org", (q) => q.eq("org_id", org_id)).collect();
    for (const m of members) await ctx.db.patch(m._id, { role: null, employee_type: null, org_id: null, name_locked: false } as any);
    if (org) await ctx.db.delete(org._id);
    await audit(ctx, user, "org.delete_hard", { org_id, target: org_id, before: { name: org?.name, plan: org?.plan_name ?? org?.plan, members: members.length }, after: { purged } });
  },
});

export const checkOrg = internalMutation({
  args: { token: v.string(), org_id: v.string(), confirm: v.string() },
  handler: async (ctx, a) => {
    await require(ctx, a.token, DEV);
    const org: any = await orgById(ctx, a.org_id);
    if (!org) throw new Error("المؤسسة غير موجودة");
    if (a.confirm.trim() !== String(org.name).trim()) throw new Error("اكتب اسم المؤسسة بالضبط لتأكيد الحذف النهائي");
    return org.name;
  },
});

// DELETE /api/dev/orgs/:id?mode=hard — permanent: purges all org data in batches, then the org itself.
export const deleteOrgHard = action({
  args: { token: v.string(), id: v.string(), confirm: v.string() },
  handler: async (ctx, a): Promise<any> => {
    await ctx.runMutation(internal.devAdmin.checkOrg, { token: a.token, org_id: a.id, confirm: a.confirm });
    const purged: Record<string, number> = {};
    for (const table of ORG_TABLES) {
      let n = 0;
      for (;;) {
        const k: number = await ctx.runMutation(internal.devAdmin.purgeBatch, { org_id: a.id, table });
        n += k;
        if (k < 400) break;
      }
      if (n) purged[table] = n;
    }
    await ctx.runMutation(internal.devAdmin.finishOrgDelete, { token: a.token, org_id: a.id, purged });
    return { ok: true, purged };
  },
});

// Soft delete (reversible): org is hidden from members (status DELETED blocks every org route); data kept.
export const softDeleteOrg = mutation({
  args: { token: v.string(), id: v.string(), restore: v.optional(v.boolean()) },
  handler: async (ctx, a) => {
    const user = await require(ctx, a.token, DEV);
    const org: any = await orgById(ctx, a.id);
    if (!org) throw new Error("المؤسسة غير موجودة");
    const patch = a.restore ? { status: "ACTIVE", deleted_at: null } : { status: "DELETED", deleted_at: nowIso() };
    await ctx.db.patch(org._id, patch as any);
    await audit(ctx, user, a.restore ? "org.restore" : "org.delete_soft", { org_id: org.id, target: org.id, before: { status: org.status }, after: patch });
    return { ok: true };
  },
});

// DELETE /api/dev/plans/:id — permanent plan delete (+ its versions). Orgs on it keep their frozen limits/snapshot.
export const deletePlan = mutation({
  args: { token: v.string(), id: v.string() },
  handler: async (ctx, a) => {
    const user = await require(ctx, a.token, DEV);
    const p: any = await ctx.db.query("plans").withIndex("by_biz_id", (q) => q.eq("id", a.id)).unique();
    if (!p) throw new Error("الخطة غير موجودة");
    const vers = await ctx.db.query("plan_versions").withIndex("by_plan", (q) => q.eq("plan_id", p.id)).collect();
    for (const x of vers) await ctx.db.delete(x._id);
    const onIt = (await ctx.db.query("organizations").collect()).filter((o: any) => o.plan_id === p.id).length;
    await ctx.db.delete(p._id);
    await audit(ctx, user, "plan.delete", { target: p.id, before: { name: p.name, tier: p.tier, versions: vers.length, orgs_on_plan: onIt } });
    return { ok: true, orgs_on_plan: onIt };
  },
});

// DELETE /api/dev/users/:id — permanent account delete (sessions, password, notifications). Owners must have their org deleted first.
export const deleteUser = mutation({
  args: { token: v.string(), id: v.string() },
  handler: async (ctx, a) => {
    const me = await require(ctx, a.token, DEV);
    const u: any = await ctx.db.query("users").withIndex("by_user_id", (q) => q.eq("user_id", a.id)).unique();
    if (!u) throw new Error("المستخدم غير موجود");
    if (u.user_id === me.user_id) throw new Error("لا يمكنك حذف حسابك الحالي");
    if (u.role === "OWNER" && u.org_id && (await orgById(ctx, u.org_id))) throw new Error("هذا مالك مؤسسة — احذف المؤسسة أولاً");
    const inv = await ctx.db.query("distributor_inventory").withIndex("by_distributor", (q) => q.eq("distributor_id", u.user_id)).collect();
    for (const r of inv) await ctx.db.delete(r._id);
    await wipeUserAuth(ctx, u.user_id);
    await ctx.db.delete(u._id);
    await audit(ctx, me, "user.delete", { org_id: u.org_id ?? undefined, target: u.user_id, before: { name: u.name, phone: u.phone, role: u.role } });
    return { ok: true };
  },
});

// DELETE /api/dev/upgrade-requests/:id — remove a payment request + its private receipt.
export const deleteRequest = mutation({
  args: { token: v.string(), id: v.string() },
  handler: async (ctx, a) => {
    const user = await require(ctx, a.token, DEV);
    const r: any = await ctx.db.query("upgrade_requests").withIndex("by_biz_id", (q) => q.eq("id", a.id)).unique();
    if (!r) throw new Error("الطلب غير موجود");
    if (r.receipt_storage) await ctx.storage.delete(r.receipt_storage).catch(() => {});
    await ctx.db.delete(r._id);
    await audit(ctx, user, "payment.delete", { org_id: r.org_id, target: r.id, before: { ref_code: r.ref_code, status: r.status, price: r.price } });
    return { ok: true };
  },
});

// POST /api/dev/orgs/:id/cancel-subscription — delete the paid subscription (org falls back to Free).
export const cancelSubscription = mutation({
  args: { token: v.string(), id: v.string() },
  handler: async (ctx, a) => {
    const user = await getUser(ctx, a.token);
    await require(ctx, a.token, DEV);
    const org: any = await orgById(ctx, a.id);
    if (!org) throw new Error("المؤسسة غير موجودة");
    const patch = { plan: "FREE", plan_id: null, plan_name: null, plan_tier: null, expires_at: null, grace_until: null, limits: {}, paid_price: 0, status: org.status === "DELETED" ? "DELETED" : "ACTIVE" };
    await ctx.db.patch(org._id, patch as any);
    await audit(ctx, user, "subscription.delete", { org_id: org.id, before: { plan: org.plan, plan_name: org.plan_name, expires_at: org.expires_at }, after: patch });
    return { ok: true };
  },
});
