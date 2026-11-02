import * as Clipboard from "expo-clipboard";
import { useState } from "react";
import { Platform } from "react-native";

import { api, fmtDate, money } from "@/src/api";
import { DocActions, normPhone, openWhatsApp } from "@/src/components/DocActions";
import { useApi } from "@/src/hooks";
import { shareReceipt } from "@/src/printDoc";
import { statementReceipt } from "@/src/receipts";
import { useToast } from "@/src/ui";

const typeLabel: Record<string, string> = { SALE: "فاتورة مبيعات", COLLECTION: "سند قبض", RETURN: "مرتجع مبيعات" };

function waText(data: any, org: any) {
  const c = data.customer;
  const t = data.rows.reduce((a: any, r: any) => ({ debit: a.debit + r.debit, credit: a.credit + r.credit }), { debit: 0, credit: 0 });
  const last = data.rows.slice(-5).map((r: any) => `• ${fmtDate(r.date)} ${typeLabel[r.type] ?? r.type} ${r.ref}: ${r.debit ? `مدين ${money(r.debit)}` : ""}${r.debit && r.credit ? " / " : ""}${r.credit ? `دائن ${money(r.credit)}` : ""}`);
  const lines = [`*${org?.name ?? ""}*`, `كشف حساب: ${c.name}`, `التاريخ: ${fmtDate(new Date().toISOString())}`, "", `إجمالي المدين: ${money(t.debit)}`, `إجمالي الدائن: ${money(t.credit)}`, `*الرصيد المستحق: ${money(c.balance)} ${org?.currency ?? ""}*`];
  if (last.length) lines.push("", "آخر الحركات:", ...last);
  if (org?.phone) lines.push("", `للاستفسار: ${org.phone}`);
  return lines.join("\n");
}

// One-tap: fetch the customer's statement, build the PDF and open the share sheet (WhatsApp).
export function useShareStatement() {
  const toast = useToast();
  const org = useApi<any>("/org/profile");
  const logo = useApi<any>("/org/logo");
  const [busyId, setBusyId] = useState<string | null>(null);
  const share = async (customerId: string) => {
    setBusyId(customerId);
    try {
      const data = await api<any>(`/customers/${customerId}/statement`);
      const cc = org.data?.phone_country_code;
      const phone = data.customer.phone;
      if (Platform.OS === "web") {
        await openWhatsApp(phone, waText(data, org.data), cc);
        return;
      }
      if (phone) {
        await Clipboard.setStringAsync(`+${normPhone(phone, cc)}`);
        toast(`تم نسخ رقم العميل +${normPhone(phone, cc)} — اختر واتساب ثم الصق الرقم`);
      }
      await shareReceipt(statementReceipt(data, org.data, logo.data?.data_uri ?? null), `كشف حساب - ${data.customer.name}`);
    } catch (e: any) {
      toast(e?.message ?? "تعذر إنشاء كشف الحساب", "error");
    } finally {
      setBusyId(null);
    }
  };
  return { share, busyId };
}

// PDF / print / WhatsApp for a customer statement (data = GET /customers/{id}/statement).
export function StatementActions({ data }: { data: any }) {
  const org = useApi<any>("/org/profile");
  const logo = useApi<any>("/org/logo");
  return (
    <DocActions
      idPrefix="statement"
      title={`كشف حساب - ${data.customer.name}`}
      phone={data.customer.phone}
      waTitle="إرسال ملخص واتساب"
      make={() => statementReceipt(data, org.data, logo.data?.data_uri ?? null)}
      waText={() => waText(data, org.data)}
    />
  );
}
