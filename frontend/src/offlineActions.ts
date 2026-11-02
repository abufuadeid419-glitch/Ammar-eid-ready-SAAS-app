// Write actions that work offline: applied to the local cache immediately,
// then queued and synced to the server (idempotent by client-generated id).
import { getLastCoords } from "@/src/location";
import { enqueue, readCache, uid, updateCached } from "@/src/offline";
import { queryClient } from "@/src/query-client";

const r2 = (n: number) => Math.round(n * 100) / 100;
const tempNo = (prefix: string, id: string) => `${prefix}-مؤقت-${id.slice(-4).toUpperCase()}`;

const geo = () => {
  const c = getLastCoords();
  return { lat: c?.lat ?? null, lng: c?.lng ?? null, client_created_at: new Date().toISOString() };
};

type Line = { product_id: string; product_name: string; quantity: number; price: number; unit?: "PIECE" | "PACKAGE"; unit_label?: string; pieces?: number };
type SaleLine = Line;

// Pieces of `product` still returnable for `customer` from the locally cached (distributor-scoped) sales and returns.
async function returnableLocal(customerId: string, productId: string) {
  const qd = (p: string) => (queryClient.getQueryData<any[]>([p]) ?? null);
  const sales = qd("/sales") ?? (await readCache<any[]>("/sales")) ?? [];
  const rets = qd("/sales-returns") ?? (await readCache<any[]>("/sales-returns")) ?? [];
  const sum = (rows: any[]) =>
    rows
      .filter((s) => s.customer_id === customerId && !s.voided)
      .reduce((m, s) => m + (s.items ?? []).filter((it: any) => it.product_id === productId).reduce((k: number, it: any) => k + Number(it.pieces ?? it.quantity ?? 0), 0), 0);
  return sum(sales) - sum(rets);
}

export async function offlineSale(p: { customer: any; lines: SaleLine[]; paid: number | null; notes: string; userName?: string; discountType?: "NONE" | "PERCENT" | "FIXED"; discountValue?: number }) {
  const id = uid();
  const items = p.lines.map((l) => ({ ...l, total: r2(l.quantity * l.price) }));
  const subtotal = r2(items.reduce((s, i) => s + i.total, 0));
  const dt = p.discountType ?? "NONE";
  const dv = p.discountValue ?? 0;
  const discount = dt === "PERCENT" ? r2((subtotal * Math.min(dv, 100)) / 100) : dt === "FIXED" ? r2(Math.min(dv, subtotal)) : 0;
  const total = r2(subtotal - discount);
  const paid = Math.min(p.paid ?? total, total);
  const remaining = r2(total - paid);
  const body = { id, customer_id: p.customer.id, items: items.map(({ product_id, quantity, unit }) => ({ product_id, quantity, unit: unit ?? "PIECE" })), paid_amount: paid, notes: p.notes, discount_type: dt, discount_value: dv, ...geo() };
  const doc = {
    id, pending: true, invoice_no: tempNo("INV", id), customer_id: p.customer.id, customer_name: p.customer.name,
    distributor_name: p.userName, items, subtotal, discount_type: discount ? dt : "NONE", discount_value: discount ? dv : 0, discount_amount: discount, total, paid_amount: paid, remaining,
    payment_type: paid >= total ? "CASH" : "CREDIT", notes: p.notes, created_at: new Date().toISOString(),
  };
  await updateCached<any[]>("/my/inventory", (inv) =>
    inv.map((i) => {
      const l = p.lines.find((x) => x.product_id === i.product_id);
      return l ? { ...i, quantity: r2(i.quantity - (l.pieces ?? l.quantity)) } : i;
    }),
  );
  await updateCached<any[]>("/customers", (cs) => cs.map((c) => (c.id === p.customer.id ? { ...c, balance: r2(c.balance + remaining) } : c)));
  await updateCached<any[]>("/sales", (s) => [doc, ...s]);
  await enqueue({ id, path: "/sales", body, label: `فاتورة · ${p.customer.name} · ${total}` });
  return doc;
}

export async function offlineCollection(p: { customer: any; amount: number; notes: string; userName?: string; currency?: "SYP" | "USD"; rate?: number }) {
  const id = uid();
  const cur = p.currency === "USD" ? "USD" : "SYP";
  const base = cur === "USD" && (p.rate ?? 0) > 0 ? r2(p.amount * (p.rate as number)) : r2(p.amount);
  const body = { id, customer_id: p.customer.id, amount: p.amount, currency: cur, notes: p.notes, ...geo() };
  const doc = { id, pending: true, receipt_no: tempNo("RCV", id), customer_id: p.customer.id, customer_name: p.customer.name, amount: base, amount_input: r2(p.amount), input_currency: cur, exchange_rate: p.rate ?? 0, notes: p.notes, collector_name: p.userName, created_at: new Date().toISOString() };
  await updateCached<any[]>("/customers", (cs) => cs.map((c) => (c.id === p.customer.id ? { ...c, balance: r2(c.balance - base) } : c)));
  await updateCached<any[]>("/collections", (s) => [doc, ...s]);
  await enqueue({ id, path: "/collections", body, label: `تحصيل · ${p.customer.name} · ${base}` });
  return doc;
}

export async function offlineReturn(p: { customer: any; line: Line; reason: string; userName?: string }) {
  const id = uid();
  const total = r2(p.line.quantity * p.line.price);
  const pieces = p.line.pieces ?? p.line.quantity;
  // Same rule as the server (returns.createSales): only what this distributor sold to this customer,
  // minus returns already made (synced or still queued). The server re-checks on sync.
  const left = await returnableLocal(p.customer.id, p.line.product_id);
  if (left <= 0) throw new Error(`لا يمكن إرجاع "${p.line.product_name}": لا توجد كمية مباعة قابلة للإرجاع لهذا العميل`);
  if (pieces > left + 1e-9) throw new Error(`كمية الإرجاع تتجاوز المباع — المتبقي القابل للإرجاع ${r2(left)} قطعة`);
  const body = { id, customer_id: p.customer.id, items: [{ product_id: p.line.product_id, quantity: p.line.quantity, price: p.line.price, unit: p.line.unit ?? "PIECE" }], reason: p.reason, ...geo() };
  const doc = { id, pending: true, return_no: tempNo("RET", id), customer_id: p.customer.id, customer_name: p.customer.name, distributor_name: p.userName, items: [{ ...p.line, total }], total, reason: p.reason, created_at: new Date().toISOString() };
  await updateCached<any[]>("/my/inventory", (inv) => {
    const found = inv.find((i) => i.product_id === p.line.product_id);
    if (found) return inv.map((i) => (i.product_id === p.line.product_id ? { ...i, quantity: r2(i.quantity + pieces) } : i));
    return [...inv, { product_id: p.line.product_id, product_name: p.line.product_name, quantity: pieces, sale_price: p.line.price }];
  });
  await updateCached<any[]>("/customers", (cs) => cs.map((c) => (c.id === p.customer.id ? { ...c, balance: r2(c.balance - total) } : c)));
  await updateCached<any[]>("/sales-returns", (s) => [doc, ...s]);
  await enqueue({ id, path: "/sales-returns", body, label: `مرتجع · ${p.customer.name} · ${total}` });
  return doc;
}

export async function offlineCustomer(p: { name: string; phone: string; address: string; type_id?: string | null; lat?: number | null; lng?: number | null }) {
  const id = uid();
  const doc = { id, pending: true, ...p, location: "", balance: 0, created_at: new Date().toISOString() };
  await updateCached<any[]>("/customers", (cs) => [...cs, doc]);
  await enqueue({ id, path: "/customers", body: { id, ...p }, label: `عميل جديد · ${p.name}` });
  return doc;
}

// Payment voucher (سند صرف): cash refund to a customer with a credit balance.
export async function offlinePayment(p: { customer: any; amount: number; notes: string; userName?: string; currency?: "SYP" | "USD"; rate?: number }) {
  const id = uid();
  const cur = p.currency === "USD" ? "USD" : "SYP";
  const base = cur === "USD" && (p.rate ?? 0) > 0 ? r2(p.amount * (p.rate as number)) : r2(p.amount);
  const body = { id, customer_id: p.customer.id, amount: p.amount, currency: cur, notes: p.notes, ...geo() };
  const doc = { id, pending: true, voucher_no: tempNo("PAY", id), customer_id: p.customer.id, customer_name: p.customer.name, amount: base, amount_input: r2(p.amount), input_currency: cur, exchange_rate: p.rate ?? 0, notes: p.notes, distributor_name: p.userName, created_at: new Date().toISOString() };
  await updateCached<any[]>("/customers", (cs) => cs.map((c) => (c.id === p.customer.id ? { ...c, balance: r2(c.balance + base) } : c)));
  await updateCached<any[]>("/payment-vouchers", (s) => [doc, ...s]);
  await enqueue({ id, path: "/payment-vouchers", body, label: `سند صرف · ${p.customer.name} · ${base}` });
  return doc;
}

type QtyLine = { product_id: string; product_name: string; quantity: number; unit?: "PIECE" | "PACKAGE"; unit_label?: string; pieces?: number };
const pcs = (l: QtyLine) => l.pieces ?? l.quantity;

// Distributor stock returned to the main warehouse (owner confirms receipt).
export async function offlineWarehouseReturn(items: QtyLine[], notes: string, userName?: string) {
  const id = uid();
  const doc = { id, pending: true, return_no: tempNo("WRT", id), items, notes, status: "PENDING", distributor_name: userName, created_at: new Date().toISOString() };
  await updateCached<any[]>("/my/inventory", (inv) =>
    inv.map((i) => {
      const l = items.find((x) => x.product_id === i.product_id);
      return l ? { ...i, quantity: r2(i.quantity - pcs(l)) } : i;
    }),
  );
  await updateCached<any[]>("/warehouse-returns", (s) => [doc, ...s]);
  await enqueue({ id, path: "/warehouse-returns", body: { id, items: items.map(({ product_id, quantity, unit }) => ({ product_id, quantity, unit: unit ?? "PIECE" })), notes }, label: `إرجاع للمستودع · ${items.length} صنف` });
  return doc;
}

export async function offlineStopStatus(route: any, stop: any, status: "VISITED" | "SKIPPED" | "PENDING") {
  const id = uid();
  await updateCached<any>("/routes/mine", (r) =>
    r && r.id === route.id ? { ...r, stops: r.stops.map((s: any) => (s.customer_id === stop.customer_id ? { ...s, status, at: new Date().toISOString() } : s)) } : r,
  );
  await enqueue({ id, path: `/routes/${route.id}/stops/${stop.customer_id}/status`, body: { status }, label: `خط السير · ${stop.customer_name}` });
}

export async function offlineStockRequest(items: { product_id: string; product_name: string; quantity: number; unit?: "PIECE" | "PACKAGE"; unit_label?: string; pieces?: number }[], note = "") {
  const id = uid();
  const doc = { id, pending: true, items, note, status: "PENDING", created_at: new Date().toISOString() };
  await updateCached<any[]>("/stock-requests", (l) => [doc, ...l]);
  await enqueue({ id, path: "/stock-requests", body: { id, items: items.map(({ product_id, quantity, unit }) => ({ product_id, quantity, unit: unit ?? "PIECE" })), note }, label: `طلب تعبئة · ${items.length} صنف` });
  return doc;
}

export async function offlineDeliveryAction(d: any, action: "confirm" | "reject") {
  const id = uid();
  await updateCached<any[]>("/deliveries", (l) => l.map((x) => (x.id === d.id ? { ...x, status: action === "confirm" ? "CONFIRMED" : "REJECTED" } : x)));
  if (action === "confirm") {
    await updateCached<any[]>("/my/inventory", (inv) => {
      let next = [...inv];
      for (const it of d.items) {
        const f = next.find((i) => i.product_id === it.product_id);
        next = f ? next.map((i) => (i.product_id === it.product_id ? { ...i, quantity: r2(i.quantity + pcs(it)) } : i)) : [...next, { product_id: it.product_id, product_name: it.product_name, quantity: pcs(it), sale_price: 0, min_stock: 0 }];
      }
      return next;
    });
  }
  await enqueue({ id, path: `/deliveries/${d.id}/${action}`, body: {}, label: `${action === "confirm" ? "تأكيد استلام" : "رفض"} شحنة` });
}
