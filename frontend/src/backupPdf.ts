import { fmtDate, money } from "@/src/api";

// Human-readable organization backup (A4 PDF): business data only — no database ids, internal
// codes, tokens or structure. Built from GET /backup/export.
const esc = (s: any) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const roleName = (e: any) => (e.role === "OWNER" ? "المالك" : e.employee_type === "ACCOUNTANT" ? "محاسب" : e.employee_type === "FIELD_AGENT" ? "موزع ميداني" : "موظف");
const unitOf = (it: any) => it.unit_label || (it.unit === "PACKAGE" ? "كرتونة" : "قطعة");

function table(title: string, head: string[], rows: any[][]) {
  if (!rows.length) return `<h2>${esc(title)}</h2><p class="empty">لا توجد بيانات</p>`;
  return `<h2>${esc(title)} <span>(${rows.length})</span></h2><table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows
    .map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`)
    .join("")}</tbody></table>`;
}

export function backupHtml(d: any) {
  const o = d.organization ?? {};
  const day = (s: string) => (s ? fmtDate(s) : "");
  const items = (its: any[] = []) => its.map((i) => `${i.product_name} × ${money(i.quantity)} ${unitOf(i)}`).join("، ");
  const sections = [
    table("بيانات المؤسسة", ["البند", "القيمة"], [
      ["اسم المؤسسة", o.name], ["الهاتف", o.phone], ["البريد الإلكتروني", o.email], ["العنوان", o.address], ["الرقم الضريبي", o.tax_no], ["السجل التجاري", o.cr_no],
      ["العملة الأساسية", o.currency], ["العملة الثانوية", o.alt_currency], ["سعر الصرف", o.exchange_rate ? money(o.exchange_rate) : ""], ["تذييل الفاتورة", o.invoice_footer],
    ].filter((r) => r[1] !== undefined && r[1] !== null && r[1] !== "")),
    table("فريق العمل", ["الاسم", "الدور", "الهاتف / البريد"], (d.employees ?? []).map((e: any) => [e.name ?? "", roleName(e), e.phone ?? e.email ?? ""])),
    table("المنتجات والمخزون", ["المنتج", "الوحدة", "قطع/عبوة", "سعر البيع", "التكلفة", "المخزون (قطعة)"], (d.products ?? []).map((p: any) => [p.name, p.unit || "قطعة", p.pieces_per_package > 1 ? `${p.pieces_per_package} / ${p.package_unit || "كرتونة"}` : "", money(p.sale_price), money(p.cost_price), money(p.stock)])),
    table("العملاء", ["العميل", "الهاتف", "العنوان", "الرصيد"], (d.customers ?? []).map((c: any) => [c.name, c.phone ?? "", c.address ?? "", money(c.balance ?? 0)])),
    table("فواتير المبيعات", ["الرقم", "التاريخ", "العميل", "الموزع", "الأصناف", "الإجمالي", "المدفوع", "المتبقي", "الحالة"], (d.sales ?? []).map((s: any) => [s.invoice_no, day(s.created_at), s.customer_name, s.distributor_name ?? "", items(s.items), money(s.total), money(s.paid_amount), money(s.remaining), s.voided ? "ملغاة" : "سارية"])),
    table("سندات القبض", ["الرقم", "التاريخ", "العميل", "المحصّل", "المبلغ", "ملاحظات"], (d.collections ?? []).map((c: any) => [c.receipt_no, day(c.created_at), c.customer_name, c.collector_name ?? "", money(c.amount), c.notes ?? ""])),
    table("مرتجعات المبيعات", ["الرقم", "التاريخ", "العميل", "الأصناف", "الإجمالي", "السبب"], (d.sales_returns ?? []).map((r: any) => [r.return_no, day(r.created_at), r.customer_name, items(r.items), money(r.total), r.reason ?? ""])),
    table("المشتريات", ["التاريخ", "المورد", "المنتج", "الكمية", "التكلفة", "الإجمالي"], (d.purchases ?? []).map((p: any) => [day(p.created_at), p.supplier ?? "", p.product_name, `${money(p.quantity)} ${unitOf(p)}`, money(p.unit_cost), money(p.total)])),
    table("مرتجعات المشتريات", ["الرقم", "التاريخ", "المورد", "المنتج", "الكمية", "الإجمالي"], (d.purchase_returns ?? []).map((p: any) => [p.return_no, day(p.created_at), p.supplier ?? "", p.product_name, `${money(p.quantity)} ${unitOf(p)}`, money(p.total)])),
    table("تسليمات البضاعة للموزعين", ["التاريخ", "الموزع", "الأصناف", "الحالة"], (d.deliveries ?? []).map((x: any) => [day(x.created_at), x.distributor_name ?? "", items(x.items), x.status === "CONFIRMED" ? "مستلمة" : x.status === "REJECTED" ? "مرفوضة" : "بانتظار الاستلام"])),
  ];
  return `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="utf-8"/><style>
@page{size:A4;margin:14mm}body{font-family:sans-serif;color:#111;font-size:11px}h1{font-size:20px;margin:0}h2{font-size:14px;margin:18px 0 6px;border-bottom:2px solid #333;padding-bottom:3px}h2 span{color:#666;font-size:11px}
table{width:100%;border-collapse:collapse}th,td{border:1px solid #bbb;padding:4px 6px;text-align:right;vertical-align:top}th{background:#eee}tr{page-break-inside:avoid}.empty{color:#777}.meta{color:#555;margin-top:4px}
</style></head><body><h1>نسخة احتياطية — ${esc(o.name)}</h1><div class="meta">تاريخ الإصدار: ${esc(fmtDate(d.exported_at ?? new Date().toISOString()))}</div>${sections.join("")}</body></html>`;
}
