import { httpRouter } from "convex/server";

import { httpAction } from "./_generated/server";
import { api, internal } from "./_generated/api";

type Kind = "q" | "m" | "a";
type Build = (c: { p: Record<string, string>; q: URLSearchParams; b: any; token: string }) => any;
type Route = [string, string, Kind, any, Build];

const T = (c: any) => ({ token: c.token });
const spread = (c: any) => ({ token: c.token, ...c.b });

// Full REST surface, served from Convex. Order matters: static sub-paths before :param ones.
const ROUTES: Route[] = [
  // auth
  ["POST", "/auth/otp/request", "a", api.edge.requestOtp, (c) => ({ phone: String(c.b.phone ?? ""), channel: c.b.channel === "whatsapp" ? "whatsapp" : undefined })],
  ["POST", "/auth/otp/verify", "a", api.edge.verifyOtp, (c) => ({ phone: String(c.b.phone ?? ""), code: String(c.b.code ?? ""), force: !!c.b.force })],
  ["POST", "/auth/start", "a", api.edge.start, (c) => ({ phone: String(c.b.phone ?? "") })],
  ["POST", "/auth/password/login", "a", api.pw.login, (c) => ({ phone: String(c.b.phone ?? ""), password: String(c.b.password ?? ""), force: !!c.b.force })],
  ["POST", "/auth/password", "a", api.pw.setPassword, (c) => ({ token: c.token, password: String(c.b.password ?? "") })],
  ["POST", "/auth/password/change", "a", api.pw.changePassword, (c) => ({ token: c.token, current: String(c.b.current ?? ""), password: String(c.b.password ?? "") })],
  ["POST", "/auth/name", "m", api.edge.setName, (c) => ({ token: c.token, name: String(c.b.name ?? "") })],
  ["GET", "/auth/me", "q", api.extra.me, T],
  ["POST", "/auth/touch", "m", api.sessions.touch, (c) => ({ token: c.token, device: c.b.device, platform: c.b.platform })],
  ["GET", "/auth/sessions", "q", api.sessions.list, T],
  ["DELETE", "/auth/sessions/:id", "m", api.sessions.revoke, (c) => ({ token: c.token, device_id: c.p.id })],
  ["POST", "/auth/logout", "m", api.extra.logout, T],
  ["POST", "/auth/consent", "m", api.extra.consent, T],
  ["DELETE", "/auth/account", "m", api.extra.deleteAccount, T],
  ["POST", "/activate", "m", api.employees.activate, (c) => ({ token: c.token, code: c.b.code })],
  ["POST", "/trial", "m", api.employees.trial, (c) => ({ token: c.token, org_name: c.b.org_name })],
  // products
  ["GET", "/products", "q", api.products.list, T],
  ["POST", "/products", "m", api.products.create, spread],
  ["PUT", "/products/:id", "m", api.products.update, (c) => ({ token: c.token, id: c.p.id, ...c.b })],
  ["DELETE", "/products/:id", "m", api.products.remove, (c) => ({ token: c.token, id: c.p.id })],
  // customers
  ["GET", "/customers", "q", api.customers.list, T],
  ["POST", "/customers", "m", api.customers.create, spread],
  ["GET", "/customers/:id/statement", "q", api.customers.statement, (c) => ({ token: c.token, id: c.p.id })],
  ["POST", "/customers/:id/reminded", "m", api.customers.reminded, (c) => ({ token: c.token, id: c.p.id })],
  ["PUT", "/customers/:id", "m", api.customers.update, (c) => ({ token: c.token, id: c.p.id, ...c.b })],
  // customer types
  ["GET", "/customer-types", "q", api.extra.customerTypesList, T],
  ["POST", "/customer-types", "m", api.extra.customerTypesCreate, spread],
  ["PUT", "/customer-types/:id", "m", api.extra.customerTypesUpdate, (c) => ({ token: c.token, id: c.p.id, ...c.b })],
  ["DELETE", "/customer-types/:id", "m", api.extra.customerTypesRemove, (c) => ({ token: c.token, id: c.p.id })],
  // sales
  ["GET", "/sales", "q", api.sales.list, T],
  ["POST", "/sales", "m", api.sales.create, spread],
  ["POST", "/sales/:id/void", "m", api.extra.voidSale, (c) => ({ token: c.token, id: c.p.id, reason: c.b.reason })],
  // collections / returns / vouchers
  ["GET", "/collections", "q", api.collections.list, T],
  ["POST", "/collections", "m", api.collections.create, spread],
  ["GET", "/sales-returns", "q", api.returns.listSales, T],
  ["POST", "/sales-returns", "m", api.returns.createSales, spread],
  ["GET", "/payment-vouchers", "q", api.vouchers.list, T],
  ["POST", "/payment-vouchers", "m", api.vouchers.create, spread],
  // purchases
  ["GET", "/purchases", "q", api.purchases.list, T],
  ["POST", "/purchases", "m", api.purchases.create, spread],
  ["GET", "/purchase-returns", "q", api.purchases.listReturns, T],
  ["POST", "/purchase-returns", "m", api.purchases.createReturn, spread],
  ["GET", "/supplier-payments", "q", api.purchases.listSupplierPayments, T],
  ["GET", "/suppliers", "q", api.purchases.listSuppliers, T],
  ["PUT", "/suppliers", "m", api.purchases.saveSupplier, spread],
  ["POST", "/supplier-payments", "m", api.purchases.createSupplierPayment, spread],
  // deliveries + inventory + stock-requests
  ["GET", "/deliveries", "q", api.deliveries.list, T],
  ["POST", "/deliveries", "m", api.deliveries.create, (c) => ({ token: c.token, distributor_id: c.b.distributor_id, items: c.b.items, notes: c.b.notes })],
  ["POST", "/deliveries/:id/confirm", "m", api.deliveries.confirm, (c) => ({ token: c.token, id: c.p.id })],
  ["POST", "/deliveries/:id/reject", "m", api.deliveries.reject, (c) => ({ token: c.token, id: c.p.id })],
  ["GET", "/my/inventory", "q", api.deliveries.myInventory, T],
  ["GET", "/inventory/distributors", "q", api.deliveries.distributorsInventory, T],
  ["GET", "/stock-requests", "q", api.deliveries.listRequests, T],
  ["POST", "/stock-requests", "m", api.deliveries.createRequest, spread],
  ["POST", "/stock-requests/:id/fulfill", "m", api.deliveries.fulfillRequest, (c) => ({ token: c.token, id: c.p.id })],
  ["POST", "/stock-requests/:id/reject", "m", api.deliveries.rejectRequest, (c) => ({ token: c.token, id: c.p.id })],
  // warehouse returns
  ["GET", "/warehouse-returns", "q", api.returns.listWarehouse, T],
  ["POST", "/warehouse-returns", "m", api.returns.createWarehouse, spread],
  ["POST", "/warehouse-returns/:id/accept", "m", api.returns.acceptWarehouse, (c) => ({ token: c.token, id: c.p.id })],
  ["POST", "/warehouse-returns/:id/reject", "m", api.returns.rejectWarehouse, (c) => ({ token: c.token, id: c.p.id, reason: c.b.reason })],
  // sales targets (live via useQuery in-app; REST kept for parity)
  ["GET", "/targets", "q", api.targets.list, (c) => ({ token: c.token, month: c.q.get("month") ?? undefined })],
  ["PUT", "/targets", "m", api.targets.set, (c) => ({ token: c.token, distributor_id: c.b.distributor_id, month: c.b.month, amount: Number(c.b.amount) })],
  // employees
  ["GET", "/employees", "q", api.employees.list, T],
  ["POST", "/employees/invite", "m", api.employees.invite, (c) => ({ token: c.token, name: c.b.name, employee_type: c.b.employee_type })],
  ["DELETE", "/employees/invite/:id", "m", api.employees.deleteInvite, (c) => ({ token: c.token, id: c.p.id })],
  ["DELETE", "/employees/:id", "m", api.employees.remove, (c) => ({ token: c.token, user_id: c.p.id })],
  // routes (static before :id)
  ["GET", "/routes/mine", "q", api.routes.mine, (c) => ({ token: c.token, date: c.q.get("date") ?? undefined })],
  ["GET", "/routes/kpis", "q", api.routes.kpis, (c) => ({ token: c.token, days: c.q.get("days") ? Number(c.q.get("days")) : undefined })],
  ["GET", "/routes", "q", api.routes.list, (c) => ({ token: c.token, date: c.q.get("date") ?? undefined, distributor_id: c.q.get("distributor_id") ?? undefined })],
  ["POST", "/routes", "m", api.routes.save, (c) => ({ token: c.token, distributor_id: c.b.distributor_id, date: c.b.date, customer_ids: c.b.customer_ids })],
  ["POST", "/routes/:id/optimize", "m", api.routes.optimize, (c) => ({ token: c.token, id: c.p.id, lat: c.b.lat ?? null, lng: c.b.lng ?? null })],
  ["POST", "/routes/:id/stops/:cid/status", "m", api.routes.stopStatus, (c) => ({ token: c.token, id: c.p.id, customer_id: c.p.cid, status: c.b.status, note: c.b.note })],
  ["DELETE", "/routes/:id", "m", api.routes.remove, (c) => ({ token: c.token, id: c.p.id })],
  // tracking
  ["POST", "/locations", "m", api.tracking.postLocation, (c) => ({ token: c.token, lat: c.b.lat, lng: c.b.lng, accuracy: c.b.accuracy ?? null })],
  ["GET", "/tracking/agents/:uid/trail", "q", api.tracking.trail, (c) => ({ token: c.token, user_id: c.p.uid, date: c.q.get("date") ?? undefined })],
  ["GET", "/tracking/agents", "q", api.tracking.agents, T],
  // stats
  ["GET", "/stats/overview", "q", api.stats.overview, T],
  ["GET", "/stats/agents", "q", api.stats.agents, T],
  ["GET", "/stats/leaderboard", "q", api.stats.leaderboard, (c) => ({ token: c.token, month: c.q.get("month") ?? undefined })],
  ["GET", "/stats/alerts", "q", api.extra.statsAlerts, T],
  ["GET", "/stats/finance", "q", api.extra.statsFinance, T],
  ["GET", "/stats/reports", "q", api.extra.statsReports, (c) => ({ token: c.token, period: c.q.get("period") ?? undefined })],
  // notifications
  ["GET", "/notifications", "q", api.notifications.list, T],
  ["POST", "/notifications/read-all", "m", api.notifications.readAll, T],
  // inventory logs
  ["GET", "/stock-movements", "q", api.extra.stockMovements, (c) => ({ token: c.token, product_id: c.q.get("product_id") ?? undefined })],
  ["GET", "/price-history", "q", api.extra.priceHistory, T],
  // debts
  ["GET", "/debts/stale", "q", api.extra.debtsStale, T],
  ["POST", "/debts/digest", "m", api.extra.debtsDigest, T],
  // org
  ["GET", "/org/profile", "q", api.extra.orgProfile, T],
  ["PUT", "/org/profile", "m", api.extra.orgProfileUpdate, spread],
  ["PUT", "/org/currency", "m", api.extra.orgCurrency, spread],
  ["PUT", "/org/pricing-method", "m", api.extra.orgPricingMethod, spread],
  ["GET", "/org/debt-sms", "q", api.proFeatures.debtSettings, T],
  ["PUT", "/org/debt-sms", "m", api.proFeatures.setDebtSettings, (c) => ({ token: c.token, enabled: !!c.b.enabled, days: Number(c.b.days) || 14 })],
  ["GET", "/org/daily-sms", "q", api.dailySms.preview, T],
  ["PUT", "/org/daily-sms", "m", api.dailySms.setEnabled, (c) => ({ token: c.token, enabled: !!c.b.enabled })],
  ["POST", "/org/daily-sms/test", "a", api.dailySms.sendTest, T],
  ["GET", "/org/logo", "a", api.edge.getLogo, T],
  ["POST", "/org/logo", "a", api.edge.uploadLogo, (c) => ({ token: c.token, data: c.b.data, content_type: c.b.content_type })],
  // plans / settings / upgrades
  ["GET", "/plans", "q", api.billing.plansList, T],
  ["GET", "/payment-methods", "q", api.billing.methodsList, T],
  ["GET", "/billing/settings", "q", api.billing.settingsGet, T],
  ["GET", "/settings/payment", "q", api.extra.settingsPayment, T],
  ["GET", "/upgrade-requests", "q", api.billing.requestsList, (c) => ({ token: c.token, status: c.q.get("status") || undefined })],
  ["POST", "/upgrade-requests", "a", api.billing.submitPayment, spread],
  ["POST", "/upgrade-requests/:id/receipt", "a", api.billing.resubmitReceipt, (c) => ({ token: c.token, id: c.p.id, receipt: String(c.b.receipt ?? ""), payment_ref: c.b.payment_ref, amount: c.b.amount })],
  ["GET", "/upgrade-requests/:id/receipt", "a", api.billing.getReceipt, (c) => ({ token: c.token, id: c.p.id })],
  ["POST", "/upgrade-requests/:id/cancel", "m", api.billing.cancelRequest, (c) => ({ token: c.token, id: c.p.id })],
  // deletion requests
  ["GET", "/deletion-requests", "q", api.extra.deletionList, T],
  ["POST", "/deletion-requests", "m", api.extra.deletionRequest, (c) => ({ token: c.token, reason: c.b.reason })],
  ["DELETE", "/deletion-requests/:id", "m", api.extra.deletionCancel, (c) => ({ token: c.token, id: c.p.id })],
  // app version (public)
  ["GET", "/app-version/latest", "q", api.extra.appVersionLatest, (c) => ({ platform: c.q.get("platform") ?? undefined })],
  // backup
  ["GET", "/backup/export", "q", api.extra.backupExport, T],
  ["GET", "/accounting/journal", "q", api.journal.journal, (c) => ({ token: c.token, from: c.q.get("from") || undefined, to: c.q.get("to") || undefined })],
  // developer console
  ["GET", "/dev/stats", "q", api.extra.devStats, T],
  ["GET", "/dev/licenses", "q", api.extra.devLicensesList, T],
  ["POST", "/dev/licenses", "m", api.extra.devLicensesCreate, spread],
  ["DELETE", "/dev/licenses/:id", "m", api.extra.devLicensesDelete, (c) => ({ token: c.token, id: c.p.id })],
  ["GET", "/dev/orgs", "q", api.extra.devOrgs, T],
  ["PATCH", "/dev/orgs/:id", "m", api.extra.devPatchOrg, (c) => ({ token: c.token, id: c.p.id, ...c.b })],
  ["POST", "/dev/plans", "m", api.billing.devPlanCreate, spread],
  ["POST", "/dev/plans/:id/publish", "m", api.billing.devPlanPublish, (c) => ({ token: c.token, id: c.p.id })],
  ["POST", "/dev/plans/:id/archive", "m", api.billing.devPlanArchive, (c) => ({ token: c.token, id: c.p.id, restore: !!c.b.restore })],
  ["GET", "/dev/plans/:id/versions", "q", api.billing.devPlanVersions, (c) => ({ token: c.token, id: c.p.id })],
  ["POST", "/dev/plans/:id/restore", "m", api.billing.devPlanRestore, (c) => ({ token: c.token, id: c.p.id, version: Number(c.b.version) })],
  ["POST", "/dev/payment-methods", "m", api.billing.devMethodSave, spread],
  ["DELETE", "/dev/payment-methods/:id", "m", api.billing.devMethodArchive, (c) => ({ token: c.token, id: c.p.id })],
  ["POST", "/dev/payment-methods/:id/qr", "a", api.billing.devMethodUploadQr, (c) => ({ token: c.token, id: c.p.id, data: c.b.data || undefined })],
  ["PUT", "/dev/billing/settings", "m", api.billing.devSettingsSave, spread],
  ["GET", "/dev/billing/stats", "q", api.billing.devStats, T],
  ["GET", "/dev/audit", "q", api.billing.devAudit, (c) => ({ token: c.token, org_id: c.q.get("org_id") || undefined })],
  ["GET", "/dev/orgs/:id", "q", api.billing.devOrgDetail, (c) => ({ token: c.token, id: c.p.id })],
  ["POST", "/dev/orgs/:id/assign-plan", "m", api.billing.devAssignPlan, (c) => ({ token: c.token, org_id: c.p.id, plan_id: String(c.b.plan_id ?? ""), days: Number(c.b.days), note: c.b.note })],
  ["PUT", "/dev/plans/:id", "m", api.billing.devPlanUpdate, (c) => ({ token: c.token, id: c.p.id, ...c.b })],
  ["DELETE", "/dev/plans/:id", "m", api.billing.devPlanArchive, (c) => ({ token: c.token, id: c.p.id })],
  ["PUT", "/dev/settings/payment", "m", api.extra.devSettingsPayment, spread],
  ["PATCH", "/dev/upgrade-requests/:id", "m", api.billing.devReview, (c) => ({ token: c.token, id: c.p.id, action: String(c.b.action ?? ""), note: c.b.note })],
  ["GET", "/dev/monitoring", "q", api.extra.devMonitoring, T],
  ["GET", "/dev/versions", "q", api.extra.devVersionsList, T],
  ["POST", "/dev/versions", "m", api.extra.devVersionCreate, spread],
  ["DELETE", "/dev/versions/:id", "m", api.extra.devVersionDelete, (c) => ({ token: c.token, id: c.p.id })],
  ["PATCH", "/dev/deletion-requests/:id", "m", api.extra.devDeletionReview, (c) => ({ token: c.token, id: c.p.id, action: c.b.action, note: c.b.note })],
];

const compiled = ROUTES.map(([method, pattern, kind, fn, build]) => {
  const names: string[] = [];
  const rx = new RegExp(
    "^" + pattern.replace(/:[A-Za-z]+/g, (m) => { names.push(m.slice(1)); return "([^/]+)"; }) + "$",
  );
  return { method, rx, names, kind, fn, build };
});

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

const json = (status: number, data: any) =>
  new Response(data === undefined ? "null" : JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });

function statusFor(msg: string) {
  if (/مصرح|الجلسة|انتهت الجلسة/.test(msg)) return 401;
  if (/صلاحية|اشتراك/.test(msg)) return 403;
  if (/غير موجود|غير موجودة/.test(msg)) return 404;
  return 400;
}

const handler = httpAction(async (ctx, request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const url = new URL(request.url);
  let path = url.pathname.replace(/^\/api/, "");
  if (path === "" || path === "/") return json(200, { message: "Smart System API (Convex)" });
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);

  const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/, "");
  let body: any = {};
  if (["POST", "PUT", "PATCH"].includes(request.method)) {
    try { body = await request.json(); } catch { body = {}; }
  }

  // RBAC: accountants are strictly read-only (only their own session/profile/notification actions are allowed).
  if (request.method !== "GET" && token && !/^\/(auth|notifications)(\/|$)/.test(path)) {
    const who: any = await ctx.runQuery(internal.journal.roleOf, { token });
    if (who?.employee_type === "ACCOUNTANT") return json(403, { detail: "حساب المحاسب للقراءة فقط — لا يملك صلاحية التعديل أو الإضافة أو الإلغاء" });
  }

  for (const r of compiled) {
    if (r.method !== request.method) continue;
    const m = r.rx.exec(path);
    if (!m) continue;
    const p: Record<string, string> = {};
    r.names.forEach((n, i) => (p[n] = decodeURIComponent(m[i + 1])));
    const args = r.build({ p, q: url.searchParams, b: body, token });
    try {
      const result =
        r.kind === "q" ? await ctx.runQuery(r.fn, args) :
        r.kind === "m" ? await ctx.runMutation(r.fn, args) :
        await ctx.runAction(r.fn, args);
      return json(200, result ?? null);
    } catch (e: any) {
      let msg = e?.message ? String(e.message) : "حدث خطأ غير متوقع";
      if (msg.includes("Uncaught Error:")) msg = msg.split("Uncaught Error:").pop() as string;
      msg = msg.split("\n")[0].trim() || "حدث خطأ غير متوقع";
      return json(statusFor(msg), { detail: msg });
    }
  }
  return json(404, { detail: "غير موجود" });
});

const http = httpRouter();
for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const) {
  http.route({ pathPrefix: "/api/", method, handler });
  http.route({ path: "/api", method, handler });
}

export default http;
