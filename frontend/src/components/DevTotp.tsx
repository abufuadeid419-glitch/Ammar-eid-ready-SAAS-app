import * as Clipboard from "expo-clipboard";
import { useState } from "react";
import { View } from "react-native";
import QRCode from "react-native-qrcode-svg";

import { api } from "@/src/api";
import { devDevice } from "@/src/devDevice";
import { spacing } from "@/src/theme";
import { Btn, Card, Field, T, useToast } from "@/src/ui";

// Shows recovery codes once, with copy + explicit "I saved them" acknowledgement.
export function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const toast = useToast();
  const [saved, setSaved] = useState(false);
  return (
    <Card style={{ gap: spacing.sm }} testID="recovery-codes-card">
      <T v="h2">رموز الاسترداد</T>
      <T v="caption" color="warning">تظهر هذه الرموز مرة واحدة فقط. احفظها في مكان آمن خارج التطبيق. كل رمز يُستخدم مرة واحدة لاسترداد الحساب إذا فقدت جوالك.</T>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
        {codes.map((c) => (
          <T key={c} testID="recovery-code" selectable style={{ writingDirection: "ltr", fontVariant: ["tabular-nums"], minWidth: 130 }}>{c}</T>
        ))}
      </View>
      <Btn testID="copy-recovery-codes" small variant="secondary" icon="copy-outline" title="نسخ الرموز" onPress={async () => { await Clipboard.setStringAsync(codes.join("\n")); setSaved(true); toast("تم النسخ"); }} />
      <Btn testID="recovery-saved-toggle" small variant="ghost" icon={saved ? "checkbox-outline" : "square-outline"} title="حفظت الرموز في مكان آمن" onPress={() => setSaved(!saved)} />
      <Btn testID="recovery-continue-button" title="متابعة" disabled={!saved} onPress={onDone} />
    </Card>
  );
}

// Authenticator enrolment (first time or reset): QR / secret → confirm a 6-digit code → recovery codes.
export function TotpSetup({ onDone }: { onDone: () => void }) {
  const toast = useToast();
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [codes, setCodes] = useState<string[] | null>(null);

  const begin = async () => {
    setBusy(true);
    try { setSetup(await api("/dev/sec/setup", { method: "POST" })); } catch (e: any) { toast(e.message, "error"); } finally { setBusy(false); }
  };
  const confirm = async () => {
    setBusy(true);
    try {
      const r = await api<{ recovery_codes: string[] }>("/dev/sec/setup/confirm", { method: "POST", body: { code, ...(await devDevice()) } });
      setCodes(r.recovery_codes);
    } catch (e: any) { toast(e.message, "error"); setCode(""); } finally { setBusy(false); }
  };

  if (codes) return <RecoveryCodes codes={codes} onDone={onDone} />;
  if (!setup) {
    return (
      <Card style={{ gap: spacing.sm }}>
        <T v="h2">إعداد تطبيق المصادقة</T>
        <T v="caption">ثبّت Google Authenticator (أو أي تطبيق مصادقة) ثم اضغط بدء الإعداد.</T>
        <Btn testID="totp-setup-begin" title="بدء الإعداد" icon="qr-code-outline" loading={busy} onPress={begin} />
      </Card>
    );
  }
  return (
    <Card style={{ gap: spacing.md }} testID="totp-setup-card">
      <T v="h2">امسح الرمز بتطبيق المصادقة</T>
      <View style={{ alignItems: "center", padding: spacing.md, backgroundColor: "#ffffff", borderRadius: 12, alignSelf: "center" }}>
        <QRCode value={setup.uri} size={190} backgroundColor="#ffffff" color="#111111" />
      </View>
      <T v="caption">أو أدخل المفتاح يدوياً:</T>
      <T testID="totp-secret" selectable style={{ writingDirection: "ltr", textAlign: "center" }}>{setup.secret.match(/.{1,4}/g)?.join(" ")}</T>
      <Btn small variant="secondary" icon="copy-outline" title="نسخ المفتاح" onPress={async () => { await Clipboard.setStringAsync(setup.secret); toast("تم النسخ"); }} />
      <Field testID="totp-setup-code" label="الرمز المكوّن من 6 أرقام" keyboardType="number-pad" maxLength={6} value={code} onChangeText={(t) => setCode(t.replace(/\D/g, ""))} />
      <Btn testID="totp-setup-confirm" title="تأكيد وتفعيل" loading={busy} disabled={code.length !== 6} onPress={confirm} />
    </Card>
  );
}
