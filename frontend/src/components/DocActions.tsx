import * as Clipboard from "expo-clipboard";
import * as SMS from "expo-sms";
import { useEffect, useState } from "react";
import { Linking, Platform, View } from "react-native";

import { btAvailable, btPlatform, btPrintPng, BtPrinter, getSavedPrinter } from "@/src/bluetooth";
import { captureReceipt } from "@/src/components/BtPrintHost";
import { PrinterSheet } from "@/src/components/PrinterSheet";
import { useApi } from "@/src/hooks";
import { printReceipt, shareReceipt } from "@/src/printDoc";
import { ReceiptDoc } from "@/src/receipts";
import { spacing } from "@/src/theme";
import { Btn, T, useToast } from "@/src/ui";

// International digits for wa.me. Local numbers (leading 0 or short) get the company's country code.
export const normPhone = (p?: string, cc?: string) => {
  const raw = (p ?? "").trim();
  const digits = raw.replace(/[^\d]/g, "");
  if (!digits || raw.startsWith("+")) return digits;
  if (digits.startsWith("00")) return digits.slice(2);
  if (cc && digits.startsWith("0")) return cc + digits.replace(/^0+/, "");
  if (cc && digits.length <= 10 && !digits.startsWith(cc)) return cc + digits;
  return digits;
};

export function openWhatsApp(phone: string | undefined, text: string, cc?: string) {
  return Linking.openURL(`https://wa.me/${normPhone(phone, cc)}?text=${encodeURIComponent(text)}`);
}

// SMS composed on the user's own phone (sent from the distributor's number to the customer).
export async function openSms(phone: string | undefined, text: string, cc?: string) {
  const to = phone ? `+${normPhone(phone, cc)}` : "";
  if (Platform.OS !== "web" && (await SMS.isAvailableAsync())) {
    await SMS.sendSMSAsync(to ? [to] : [], text);
    return;
  }
  await Linking.openURL(`sms:${to}${Platform.OS === "ios" ? "&" : "?"}body=${encodeURIComponent(text)}`);
}

function BluetoothPrint({ make }: { make: () => ReceiptDoc }) {
  const toast = useToast();
  const [printer, setPrinter] = useState<BtPrinter | null>(null);
  const [pickOpen, setPickOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    getSavedPrinter().then(setPrinter);
  }, []);

  const print = async (p: BtPrinter) => {
    setBusy(true);
    try {
      await btPrintPng(await captureReceipt(make().ops), p);
      toast("تم إرسال الإيصال للطابعة");
    } catch (e: any) {
      toast(`تعذرت الطباعة عبر البلوتوث: ${e?.message ?? ""}`, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <View style={{ flexDirection: "row", gap: spacing.sm, alignItems: "center" }}>
        <Btn testID="bt-print-button" style={{ flex: 1 }} small icon="bluetooth" loading={busy} title={printer ? `طباعة بلوتوث · ${printer.name}` : "طباعة بلوتوث"} onPress={() => (printer ? print(printer) : setPickOpen(true))} />
        {printer && <Btn testID="bt-change-printer" small variant="ghost" title="تغيير" onPress={() => setPickOpen(true)} />}
      </View>
      <PrinterSheet
        visible={pickOpen}
        onClose={() => setPickOpen(false)}
        onPicked={(p) => {
          setPrinter(p);
          setPickOpen(false);
          setTimeout(() => print(p), 400);
        }}
      />
    </>
  );
}

// PDF / print (80mm thermal) / Bluetooth / WhatsApp buttons shared by invoices, vouchers and statements.
export function DocActions({ make, title, phone, waText, idPrefix, smsTitle }: { make: () => ReceiptDoc; title: string; phone?: string; waText: () => string; waTitle?: string; idPrefix: string; smsTitle?: string }) {
  const toast = useToast();
  const org = useApi<any>("/org/profile");
  const share = async () => {
    try {
      await shareReceipt(make(), title);
    } catch (e: any) {
      toast(e?.message ?? "تعذر إنشاء الملف", "error");
    }
  };
  const print = async () => {
    try {
      await printReceipt(make());
    } catch {}
  };
  // PDF via the phone share sheet (WhatsApp). The customer's number is copied first so it
  // can be pasted in WhatsApp's search; on web we fall back to a WhatsApp text message.
  const sharePdfWhatsApp = async () => {
    const cc = org.data?.phone_country_code;
    if (Platform.OS === "web") return openWhatsApp(phone, waText(), cc).catch(() => toast("تعذر فتح واتساب", "error"));
    try {
      if (phone) {
        await Clipboard.setStringAsync(`+${normPhone(phone, cc)}`);
        toast(`تم نسخ رقم العميل +${normPhone(phone, cc)} — اختر واتساب ثم الصق الرقم`);
      }
      await shareReceipt(make(), title);
    } catch (e: any) {
      toast(e?.message ?? "تعذر إنشاء الملف", "error");
    }
  };
  return (
    <View style={{ gap: spacing.sm }}>
      {btAvailable && <BluetoothPrint make={make} />}
      <Btn testID={`${idPrefix}-whatsapp-pdf-button`} small icon="logo-whatsapp" title={phone ? `إرسال PDF عبر واتساب إلى ${phone}` : "إرسال PDF عبر واتساب"} onPress={sharePdfWhatsApp} />
      <View style={{ flexDirection: "row", gap: spacing.sm }}>
        <Btn testID={`${idPrefix}-share-pdf-button`} style={{ flex: 1 }} small variant={btAvailable ? "secondary" : "primary"} title={Platform.OS === "web" ? "PDF / حفظ" : "PDF / مشاركة"} icon="document-text-outline" onPress={share} />
        <Btn testID={`${idPrefix}-print-button`} style={{ flex: 1 }} small variant="secondary" title="طباعة" icon="print-outline" onPress={print} />
      </View>
      <Btn testID={`${idPrefix}-sms-button`} small variant="ghost" icon="chatbox-ellipses-outline" title={smsTitle ?? "إرسال رسالة نصية SMS إلى العميل"} onPress={() => openSms(phone, waText(), org.data?.phone_country_code).catch(() => toast("تعذر فتح الرسائل النصية", "error"))} />
      <T v="caption" style={{ textAlign: "center" }} testID={`${idPrefix}-paper-size`}>
        مقاس الطباعة: ورق حراري 80 مم
        {btPlatform && !btAvailable ? " · الطباعة المباشرة عبر البلوتوث متاحة في التطبيق المثبت" : ""}
        {Platform.OS !== "web" ? " · يُفتح خيار المشاركة: اختر واتساب ثم العميل" : ""}
      </T>
    </View>
  );
}
