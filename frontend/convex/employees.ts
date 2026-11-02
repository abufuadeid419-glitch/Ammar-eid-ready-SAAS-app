import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
import {
  OWNER,
  STAFF,
  clean,
  cleanAll,
  genCode,
  getUser,
  isPro,
  newId,
  nowIso,
  orgById,
  orgLimits,
  require,
} from "./lib";

// GET /api/employees  (STAFF)
export const list = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const user = await require(ctx, token, STAFF);
    const employees = (await ctx.db.query("users").withIndex("by_org", (q) => q.eq("org_id", user.org_id!)).collect()).filter(
      (u) => u.role === "EMPLOYEE",
    );
    const invitations = (await ctx.db.query("invitations").withIndex("by_org", (q) => q.eq("org_id", user.org_id!)).collect()).filter(
      (i) => !i.used,
    );
    return { employees: cleanAll(employees), invitations: cleanAll(invitations) };
  },
});

// POST /api/employees/invite  (OWNER) — creates an EMP- activation code.
export const invite = mutation({
  args: { token: v.string(), name: v.string(), employee_type: v.string() },
  handler: async (ctx, { token, name, employee_type }) => {
    const user = await require(ctx, token, OWNER);
    if (!["FIELD_AGENT", "ACCOUNTANT"].includes(employee_type)) throw new Error("نوع غير صالح");
    const org = await orgById(ctx, user.org_id);
    const employees = (await ctx.db.query("users").withIndex("by_org", (q) => q.eq("org_id", user.org_id!)).collect()).filter(
      (u) => u.role === "EMPLOYEE",
    ).length;
    const invites = (await ctx.db.query("invitations").withIndex("by_org", (q) => q.eq("org_id", user.org_id!)).collect()).filter(
      (i) => !i.used,
    ).length;
    const lim = await orgLimits(ctx, org);
    if (employees + invites >= lim.employees) throw new Error("تم الوصول للحد الأقصى من الموظفين في خطتك — قم بالترقية لإضافة المزيد");
    // Plans can cap distributors separately from the total employee count.
    if (employee_type === "FIELD_AGENT" && lim.distributors != null) {
      const maxD = lim.distributors;
      const agents = (await ctx.db.query("users").withIndex("by_org", (q) => q.eq("org_id", user.org_id!)).collect()).filter(
        (u: any) => u.role === "EMPLOYEE" && u.employee_type === "FIELD_AGENT",
      ).length;
      const agentInvites = (await ctx.db.query("invitations").withIndex("by_org", (q) => q.eq("org_id", user.org_id!)).collect()).filter(
        (i: any) => !i.used && i.employee_type === "FIELD_AGENT",
      ).length;
      if (agents + agentInvites >= maxD) throw new Error(maxD === 1 ? "خطتك تسمح بموزع واحد فقط — قم بالترقية لإضافة المزيد" : `خطتك تسمح بـ ${maxD} موزعين فقط — قم بالترقية لإضافة المزيد`);
    }
    const doc = {
      id: newId(),
      org_id: user.org_id!,
      code: genCode("EMP-"),
      name,
      employee_type,
      used: false,
      created_at: nowIso(),
    };
    await ctx.db.insert("invitations", doc);
    return doc;
  },
});

export const deleteInvite = mutation({
  args: { token: v.string(), id: v.string() },
  handler: async (ctx, { token, id }) => {
    const user = await require(ctx, token, OWNER);
    const inv = await ctx.db.query("invitations").withIndex("by_biz_id", (q) => q.eq("id", id)).unique();
    if (inv && inv.org_id === user.org_id) await ctx.db.delete(inv._id);
    return { ok: true };
  },
});

// DELETE /api/employees/{uid}  (OWNER) — unlink employee + clear their stock.
export const remove = mutation({
  args: { token: v.string(), user_id: v.string() },
  handler: async (ctx, { token, user_id }) => {
    const user = await require(ctx, token, OWNER);
    const emp = await ctx.db.query("users").withIndex("by_user_id", (q) => q.eq("user_id", user_id)).unique();
    if (emp && emp.org_id === user.org_id && emp.role === "EMPLOYEE") {
      await ctx.db.patch(emp._id, { role: null, employee_type: null, org_id: null });
    }
    const inv = await ctx.db.query("distributor_inventory").withIndex("by_distributor", (q) => q.eq("distributor_id", user_id)).collect();
    for (const r of inv) await ctx.db.delete(r._id);
    return { ok: true };
  },
});

// POST /api/activate — redeem an employee invite (EMP-) or an owner license code.
export const activate = mutation({
  args: { token: v.string(), code: v.string() },
  handler: async (ctx, { token, code: raw }) => {
    const user = await getUser(ctx, token);
    if (user.role) throw new Error("الحساب مفعل مسبقاً");
    const code = raw.trim().toUpperCase();
    if (code.startsWith("EMP-")) {
      const inv = (await ctx.db.query("invitations").withIndex("by_code", (q) => q.eq("code", code)).collect()).find((i) => !i.used);
      if (!inv) throw new Error("رمز الموظف غير صالح أو مستخدم");
      const org = await orgById(ctx, inv.org_id);
      if (!org || org.status !== "ACTIVE") throw new Error("اشتراك المؤسسة غير فعال");
      await ctx.db.patch(user._id, { role: "EMPLOYEE", employee_type: inv.employee_type, org_id: inv.org_id, name: inv.name || user.name });
      await ctx.db.patch(inv._id, { used: true, user_id: user.user_id, used_at: nowIso() });
    } else {
      const lic = (await ctx.db.query("licenses").withIndex("by_code", (q) => q.eq("code", code)).collect()).find((l) => l.status === "READY");
      if (!lic) throw new Error("رمز الترخيص غير صالح أو مستخدم");
      const org_id = newId();
      await ctx.db.insert("organizations", {
        id: org_id,
        name: lic.org_name,
        owner_id: user.user_id,
        owner_email: user.email,
        status: "ACTIVE",
        plan: "LICENSE",
        max_employees: lic.max_employees,
        expires_at: new Date(Date.now() + (lic.days ?? 0) * 86400000).toISOString(),
        created_at: nowIso(),
      });
      await ctx.db.patch(lic._id, { status: "ACTIVE", org_id, used_by: user.email, activated_at: nowIso() });
      await ctx.db.patch(user._id, { role: "OWNER", org_id });
    }
    const fresh = await ctx.db.get(user._id);
    return { user: clean(fresh), org: clean(await orgById(ctx, fresh!.org_id)) };
  },
});

// POST /api/trial — start a 14-day trial organization.
export const trial = mutation({
  args: { token: v.string(), org_name: v.string() },
  handler: async (ctx, { token, org_name }) => {
    const user = await getUser(ctx, token);
    if (user.role) throw new Error("الحساب مفعل مسبقاً");
    if (!org_name.trim()) throw new Error("اسم المؤسسة مطلوب");
    const org_id = newId();
    await ctx.db.insert("organizations", {
      id: org_id,
      name: org_name.trim(),
      owner_id: user.user_id,
      owner_email: user.email,
      status: "ACTIVE",
      plan: "TRIAL",
      max_employees: 3,
      expires_at: new Date(Date.now() + 14 * 86400000).toISOString(),
      created_at: nowIso(),
    });
    await ctx.db.patch(user._id, { role: "OWNER", org_id });
    const fresh = await ctx.db.get(user._id);
    return { user: clean(fresh), org: clean(await orgById(ctx, org_id)) };
  },
});
