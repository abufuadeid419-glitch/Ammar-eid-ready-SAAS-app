import { useMemo, useState } from "react";
import { View } from "react-native";

import { fmtDate, money } from "@/src/api";
import { DocActions } from "@/src/components/DocActions";
import { useApi, useMutate } from "@/src/hooks";
import { shareReceipt } from "@/src/printDoc";
import { SupplierStatement, supplierPaymentReceipt, supplierStatementReceipt } from "@/src/receipts";
import { spacing } from "@/src/theme";
import { Btn, Card, Empty, Field, IconBtn, Loading, Row, Segments, Sheet, T, useToast } from "@/src/ui";

// Group warehouse purchases + purchase returns by supplier name.
function group(purchases: any[], returns: any[], payments: any[]): SupplierStatement[] {
  const m = new Map<string, SupplierStatement>();
  const get = (name: string) => {
    const k = name.trim() || "بدون مورد";
    if (!m.has(k)) m.set(k, { name: k, rows: [], balance: 0 });
    return m.get(k)!;
  };
  for (const p of purchases) get(p.supplier ?? "").rows.push({ type: "PURCHASE", ref: "", product: p.product_name, quantity: p.quantity, debit: 0, credit: p.total ?? 0, date: p.created_at });
  for (const r of returns) get(r.supplier ?? "").rows.push({ type: "PURCHASE_RETURN", ref: r.return_no ?? "", product: r.product_name, quantity: r.quantity, debit: r.total ?? 0, credit: 0, date: r.created_at });
  for (const p of payments) get(p.supplier ?? "").rows.push({ type: "SUPPLIER_PAYMENT", ref: p.voucher_no ?? "", product: p.notes ?? "", quantity: 0, debit: p.amount ?? 0, credit: 0, date: p.created_at, doc: p });
  const list = [...m.values()];
  for (const s of list) {
    s.rows.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    s.balance = s.rows.reduce((b, x) => b + x.credit - x.debit, 0);
  }
  return list.sort((a, b) => b.balance - a.balance);
}

const waText = (s: SupplierStatement, org: any) =>
  [`*${org?.name ?? ""}*`, `كشف حساب المورد: ${s.name}`, `التاريخ: ${fmtDate(new Date().toISOString())}`, `عدد الحركات: ${s.rows.length}`, `*المستحق للمورد: ${money(s.balance)} ${org?.currency ?? ""}*`].join("\n");

export function SupplierStatementsSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const toast = useToast();
  const purchases = useApi<any[]>("/purchases", visible);
  const returns = useApi<any[]>("/purchase-returns", visible);
  const payments = useApi<any[]>("/supplier-payments", visible);
  const org = useApi<any>("/org/profile", visible);
  const logo = useApi<any>("/org/logo", visible);
  const [sel, setSel] = useState<string | null>(null);
  const [pay, setPay] = useState<{ amount: string; currency: "SYP" | "USD"; notes: string } | null>(null);
  const savePay = useMutate("POST", "/supplier-payments", "تم تسجيل الدفعة للمورد", () => setPay(null));
  const suppliers = useMemo(() => group(purchases.data ?? [], returns.data ?? [], payments.data ?? []), [purchases.data, returns.data, payments.data]);
  const current = suppliers.find((s) => s.name === sel) ?? null;
  const contacts = useApi<any[]>("/suppliers", visible);
  const contact = contacts.data?.find((c) => c.name === current?.name);
  const [phoneEdit, setPhoneEdit] = useState<string | null>(null);
  const saveContact = useMutate("PUT", "/suppliers", "تم حفظ رقم المورد", () => setPhoneEdit(null));
  const make = (s: SupplierStatement) => supplierStatementReceipt(s, org.data, logo.data?.data_uri ?? null);
  const shareNow = (s: SupplierStatement) => shareReceipt(make(s), `كشف حساب مورد - ${s.name}`).catch((e: any) => toast(e?.message ?? "تعذر إنشاء الملف", "error"));
  const shareVoucher = (p: any) => shareReceipt(supplierPaymentReceipt(p, org.data, logo.data?.data_uri ?? null), p.voucher_no).catch((e: any) => toast(e?.message ?? "تعذر إنشاء الملف", "error"));
  const hasUsd = Number(org.data?.exchange_rate ?? 0) > 0;
  const submitPay = () => {
    if (!current || !pay) return;
    const amount = Number(pay.amount);
    if (!(amount > 0)) return toast("أدخل مبلغاً صحيحاً", "error");
    savePay.mutate({ supplier: current.name, amount, currency: pay.currency, notes: pay.notes });
  };
  const close = () => {
    setSel(null);
    setPay(null);
    onClose();
  };

  return (
    <Sheet testID="supplier-statements-sheet" visible={visible} onClose={close} title={current ? `كشف حساب: ${current.name}` : "كشوف حساب الموردين"}>
      {purchases.isLoading || returns.isLoading || payments.isLoading ? (
        <Loading />
      ) : current ? (
        <>
          <Btn testID="supplier-back-button" small variant="ghost" icon="arrow-forward" title="كل الموردين" onPress={() => { setSel(null); setPay(null); setPhoneEdit(null); }} />
          <Card style={{ gap: spacing.xs }}>
            <T v="h2">{current.name}</T>
            <T v="caption">{current.rows.length} حركة</T>
            <T v="label" color={current.balance > 0 ? "warning" : "success"} testID="supplier-balance">المستحق للمورد: {money(current.balance)}</T>
            {phoneEdit !== null ? (
              <View style={{ gap: spacing.sm }}>
                <Field testID="supplier-phone-input" label="رقم هاتف المورد (واتساب / SMS)" keyboardType="phone-pad" value={phoneEdit} onChangeText={setPhoneEdit} placeholder="09xxxxxxxx" />
                <View style={{ flexDirection: "row", gap: spacing.sm }}>
                  <Btn testID="supplier-phone-save-button" style={{ flex: 1 }} small icon="checkmark" title="حفظ الرقم" loading={saveContact.isPending} onPress={() => saveContact.mutate({ name: current.name, phone: phoneEdit.trim() })} />
                  <Btn testID="supplier-phone-cancel-button" small variant="ghost" title="إلغاء" onPress={() => setPhoneEdit(null)} />
                </View>
              </View>
            ) : (
              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                <T v="caption" style={{ flex: 1 }} testID="supplier-phone">{contact?.phone ? `الهاتف: ${contact.phone}` : "لا يوجد رقم هاتف محفوظ"}</T>
                <Btn testID="supplier-phone-edit-button" small variant="ghost" icon="call-outline" title={contact?.phone ? "تعديل الرقم" : "إضافة رقم"} onPress={() => setPhoneEdit(contact?.phone ?? "")} />
              </View>
            )}
          </Card>
          {pay ? (
            <Card style={{ gap: spacing.md }} testID="supplier-payment-form">
              <T v="label">دفعة جديدة للمورد</T>
              {hasUsd && <Segments value={pay.currency} onChange={(c) => setPay({ ...pay, currency: c })} options={[{ key: "SYP", label: org.data?.currency || "ل.س" }, { key: "USD", label: "دولار $" }]} />}
              <Field testID="supplier-payment-amount-input" label={`المبلغ (${pay.currency === "USD" ? "$" : org.data?.currency || "ل.س"})`} keyboardType="decimal-pad" value={pay.amount} onChangeText={(v) => setPay({ ...pay, amount: v.replace(/[^\d.]/g, "") })} />
              {pay.currency === "USD" && Number(pay.amount) > 0 && <T v="caption" testID="supplier-payment-converted">≈ {money(Number(pay.amount) * Number(org.data?.exchange_rate))} {org.data?.currency}</T>}
              <Field testID="supplier-payment-notes-input" label="البيان (اختياري)" value={pay.notes} onChangeText={(v) => setPay({ ...pay, notes: v })} placeholder="مثال: دفعة نقدية" />
              <View style={{ flexDirection: "row", gap: spacing.sm }}>
                <Btn testID="supplier-payment-save-button" style={{ flex: 1 }} small icon="checkmark" title="حفظ الدفعة" loading={savePay.isPending} onPress={submitPay} />
                <Btn testID="supplier-payment-cancel-button" small variant="ghost" title="إلغاء" onPress={() => setPay(null)} />
              </View>
            </Card>
          ) : (
            current.balance > 0 && <Btn testID="supplier-add-payment-button" icon="cash-outline" title="تسجيل دفعة للمورد" onPress={() => setPay({ amount: "", currency: "SYP", notes: "" })} />
          )}
          <DocActions idPrefix="supplier-statement" title={`كشف حساب مورد - ${current.name}`} phone={contact?.phone} smsTitle="إرسال رسالة نصية SMS إلى المورد" make={() => make(current)} waText={() => waText(current, org.data)} />
          {current.rows.map((r, i) =>
            r.type === "SUPPLIER_PAYMENT" ? (
              <Row key={i} testID={`supplier-payment-row-${i}`} icon="cash-outline" title={`دفعة ${r.ref}${r.product ? ` · ${r.product}` : ""}`} subtitle={`${fmtDate(r.date)} · اضغط لمشاركة السند PDF`} onPress={() => shareVoucher(r.doc)} right={<T v="label" color="success">{money(r.debit)}</T>} />
            ) : (
              <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <T v="label">{r.type === "PURCHASE" ? "مشتريات" : `مرتجع ${r.ref}`} · {r.product} × {money(r.quantity)}</T>
                  <T v="caption">{fmtDate(r.date)}</T>
                </View>
                <T v="label" color={r.credit ? "warning" : "success"}>{money(r.credit || r.debit)}</T>
              </View>
            ),
          )}
        </>
      ) : !suppliers.length ? (
        <Empty icon="people-outline" text="لا توجد مشتريات من موردين بعد" />
      ) : (
        <>
          <T v="caption">اضغط أيقونة المشاركة لإرسال كشف حساب PDF للمورد بضغطة واحدة</T>
          {suppliers.map((s, i) => (
            <Row
              key={s.name}
              testID={`supplier-row-${i}`}
              icon="storefront-outline"
              title={s.name}
              subtitle={`${s.rows.length} حركة · المستحق ${money(s.balance)}`}
              onPress={() => setSel(s.name)}
              right={<IconBtn testID={`supplier-share-pdf-${i}`} icon="share-outline" tone="brand" onPress={() => shareNow(s)} />}
            />
          ))}
        </>
      )}
    </Sheet>
  );
}
