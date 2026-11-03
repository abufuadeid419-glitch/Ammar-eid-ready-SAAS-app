// One print/send popup for EVERY saved document (sale, returns, receipt & payment vouchers, warehouse
// returns, purchases, purchase returns, supplier payments). Screens call showDocDone(kind, doc) right
// after a successful save; the single host mounted at the app root renders the same sheet design.
import { useSyncExternalStore } from "react";
import { View } from "react-native";

import { fmtDate, money } from "@/src/api";
import { DocActions } from "@/src/components/DocActions";
import { invoiceWaText } from "@/src/components/InvoiceActions";
import { qtyLabel } from "@/src/components/UnitToggle";
import { useApi } from "@/src/hooks";
import { useSyncState } from "@/src/offline";
import {
  collectionReceipt,
  invoiceReceipt,
  paymentReceipt,
  purchaseReceipt,
  supplierPaymentReceipt,
  warehouseReturnReceipt,
} from "@/src/receipts";
import { radius, spacing, useTheme } from "@/src/theme";
import { Btn, Ionicons, Sheet, T } from "@/src/ui";

export type DocKind = "sale" | "return" | "collection" | "payment" | "wreturn" | "purchase" | "purchase_return" | "supplier_payment";

const META: Record<DocKind, { label: string; no: string; path: string; party: "customer" | "supplier" | null; icon: any }> = {
  sale: { label: "فاتورة المبيعات", no: "invoice_no", path: "/sales", party: "customer", icon: "receipt-outline" },
  return: { label: "فاتورة المرتجع", no: "return_no", path: "/sales-returns", party: "customer", icon: "return-down-back-outline" },
  collection: { label: "سند القبض", no: "receipt_no", path: "/collections", party: "customer", icon: "cash-outline" },
  payment: { label: "سند الصرف", no: "voucher_no", path: "/payment-vouchers", party: "customer", icon: "wallet-outline" },
  wreturn: { label: "إذن الإرجاع للمستودع", no: "return_no", path: "/warehouse-returns", party: null, icon: "business-outline" },
  purchase: { label: "فاتورة الشراء", no: "purchase_no", path: "/purchases", party: "supplier", icon: "cart-outline" },
  purchase_return: { label: "مرتجع المشتريات", no: "return_no", path: "/purchase-returns", party: "supplier", icon: "arrow-undo-outline" },
  supplier_payment: { label: "سند الصرف للمورد", no: "voucher_no", path: "/supplier-payments", party: "supplier", icon: "wallet-outline" },
};

type State = { kind: DocKind; doc: any } | null;
let state: State = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const sub = (f: () => void) => {
  subs.add(f);
  return () => {
    subs.delete(f);
  };
};
const get = () => state;

/** Open the print/send popup for a just-saved document. Waits for the source sheet to finish closing
 *  (iOS can't present a modal while another one is dismissing). */
export function showDocDone(kind: DocKind, doc: any) {
  if (!doc) return;
  setTimeout(() => {
    state = { kind, doc };
    emit();
  }, 450);
}

function genericWaText(kind: DocKind, doc: any, org: any, no: string) {
  const m = META[kind];
  const party = doc.customer_name ?? doc.supplier ?? doc.distributor_name;
  const items: any[] = doc.items ?? (doc.product_name ? [doc] : []);
  return [
    `*${org?.name ?? ""}*`,
    `${m.label} رقم: ${no}`,
    `التاريخ: ${fmtDate(doc.created_at)}`,
    ...(party ? [`${m.party === "supplier" ? "المورد" : m.party === "customer" ? "العميل" : "الموزع"}: ${party}`] : []),
    ...items.map((i) => `• ${i.product_name} × ${qtyLabel(i)}`),
    ...(doc.total ?? doc.amount) != null ? [`${doc.total != null ? "الإجمالي" : "المبلغ"}: ${money(doc.total ?? doc.amount)} ${org?.currency ?? ""}`] : [],
    "",
    "شكراً لتعاملكم معنا",
  ].join("\n");
}

export function DocDoneHost() {
  const s = useSyncExternalStore(sub, get, get);
  const { colors } = useTheme();
  const { online } = useSyncState();
  const open = !!s;
  const m = s ? META[s.kind] : null;
  const org = useApi<any>("/org/profile", open);
  const logo = useApi<any>("/org/logo", open);
  const customers = useApi<any[]>("/customers", open && m?.party === "customer");
  const suppliers = useApi<any[]>("/suppliers", open && m?.party === "supplier");
  // Pending (offline-queued) docs already carry their FINAL number; once synced, show the server copy.
  const list = useApi<any[]>(m?.path ?? "/sales", open && !!s?.doc?.pending);
  const close = () => {
    state = null;
    emit();
  };
  if (!s || !m) return null;
  const doc = (s.doc.pending && list.data?.find((d) => d.id === s.doc.id && !d.pending)) || s.doc;
  const no = String(doc[m.no] ?? "");
  const customer = customers.data?.find((c) => c.id === doc.customer_id);
  const supplier = suppliers.data?.find((x) => x.name === doc.supplier);
  const phone = m.party === "customer" ? customer?.phone : supplier?.phone;
  const lg = logo.data?.data_uri ?? null;
  const o = org.data;
  const make = () => {
    switch (s.kind) {
      case "sale":
      case "return": return invoiceReceipt(doc, o, lg, customer);
      case "collection": return collectionReceipt(doc, o, lg, customer);
      case "payment": return paymentReceipt(doc, o, lg, customer);
      case "wreturn": return warehouseReturnReceipt(doc, o, lg);
      case "purchase": return purchaseReceipt(doc, o, lg, false);
      case "purchase_return": return purchaseReceipt(doc, o, lg, true);
      case "supplier_payment": return supplierPaymentReceipt(doc, o, lg);
    }
  };
  const waText = () => (s.kind === "sale" || s.kind === "return" ? invoiceWaText(doc, o) : genericWaText(s.kind, doc, o, no));
  const party = doc.customer_name ?? doc.supplier ?? doc.distributor_name ?? "";
  const amount = doc.total ?? doc.amount;
  const isSale = s.kind === "sale";

  return (
    <Sheet
      testID="doc-done-sheet"
      visible
      onClose={close}
      title={`تم حفظ ${m.label}`}
      footer={<Btn testID="doc-done-close-button" variant="secondary" icon="checkmark-done-outline" title={isSale ? "فاتورة جديدة" : "تم"} onPress={close} />}
    >
      <View style={{ gap: spacing.md }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
          <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name={m.icon} size={22} color={colors.brandPrimary} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <T v="h2" testID="doc-done-number">{m.label} {`\u2066${no}\u2069`}</T>
            {!!party && <T v="caption" testID="doc-done-party">{party}</T>}
          </View>
        </View>
        {s.kind === "wreturn" && (
          <T v="caption" color="info" testID="doc-done-wreturn-note">بانتظار تأكيد المستودع لاستلام البضاعة</T>
        )}
        {doc.pending && (
          <T v="caption" color="warning" testID="doc-done-pending">
            {online ? "جارٍ المزامنة… الرقم نهائي ولن يتغير" : "محفوظ على الجهاز برقمه النهائي — سيُزامن عند الاتصال"}
          </T>
        )}
        <View style={{ flexDirection: "row", gap: spacing.sm }}>
          {amount != null && (
            <View style={{ flex: 1, padding: spacing.sm, borderRadius: radius.md, backgroundColor: colors.surfaceTertiary }}>
              <T v="caption">{doc.total != null ? "الإجمالي" : "المبلغ"}</T>
              <T v="label" testID="doc-done-amount">{money(amount)}</T>
            </View>
          )}
          {isSale && (
            <>
              <View style={{ flex: 1, padding: spacing.sm, borderRadius: radius.md, backgroundColor: colors.surfaceTertiary }}>
                <T v="caption">المدفوع</T>
                <T v="label" color="success" testID="doc-done-paid">{money(doc.paid_amount)}</T>
              </View>
              <View style={{ flex: 1, padding: spacing.sm, borderRadius: radius.md, backgroundColor: colors.surfaceTertiary }}>
                <T v="caption">المتبقي</T>
                <T v="label" color={doc.remaining > 0 ? "warning" : "success"} testID="doc-done-remaining">{money(doc.remaining)}</T>
              </View>
            </>
          )}
          {!isSale && (doc.items?.length || doc.product_name) && (
            <View style={{ flex: 1, padding: spacing.sm, borderRadius: radius.md, backgroundColor: colors.surfaceTertiary }}>
              <T v="caption">الأصناف</T>
              <T v="label" numberOfLines={1}>{doc.items ? `${doc.items.length} صنف` : `${doc.product_name} × ${qtyLabel(doc)}`}</T>
            </View>
          )}
        </View>
        <T v="label" color="onSurfaceSecondary">طباعة أو إرسال المستند</T>
        <DocActions
          idPrefix="doc-done"
          title={no}
          phone={phone}
          smsTitle={m.party === "supplier" ? "إرسال رسالة نصية SMS إلى المورد" : undefined}
          make={make}
          waText={waText}
        />
      </View>
    </Sheet>
  );
}
