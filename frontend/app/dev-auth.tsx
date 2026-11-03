import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { TotpSetup } from "@/src/components/DevTotp";
import { devDevice } from "@/src/devDevice";
import { spacing, useTheme } from "@/src/theme";
import { Btn, Card, Field, Ionicons, Loading, T, useToast } from "@/src/ui";

// Developer gate: password already passed → 2FA (or recovery code) → trusted device / approval.
export default function DevAuth() {
  const { logout, refresh } = useAuth();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState(false);
  const [busy, setBusy] = useState(false);
  const st = useQuery<any>({
    queryKey: ["dev-sec-status"],
    queryFn: () => api("/dev/sec/status"),
    refetchInterval: (q) => (q.state.data?.pending ? 4000 : false),
    networkMode: "always",
  });
  const s = st.data;
  useEffect(() => {
    if (s?.verified) refresh();
  }, [s?.verified, refresh]);

  const verify = async () => {
    setBusy(true);
    try {
      const r = await api<{ status: string; code?: string }>("/dev/sec/verify", { method: "POST", body: { code, ...(await devDevice()) } });
      setCode("");
      if (r.status === "ok") await refresh();
      else { setRecovery(false); st.refetch(); }
    } catch (e: any) {
      toast(e.message, "error");
      setCode("");
      st.refetch().catch(() => {});
    } finally { setBusy(false); }
  };

  const pending = s?.pending;
  return (
    <ScrollView testID="dev-auth-screen" style={{ flex: 1, backgroundColor: colors.surface }} contentContainerStyle={{ padding: spacing.xl, paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.xl, gap: spacing.md }} keyboardShouldPersistTaps="handled">
      <View style={{ alignItems: "center", gap: spacing.sm }}>
        <Ionicons name="shield-checkmark-outline" size={48} color={colors.brandPrimary} />
        <T v="title" style={{ textAlign: "center" }}>حساب محمي</T>
        <T v="caption" style={{ textAlign: "center" }}>الوصول إلى لوحة التحكم يتطلب التحقق بخطوتين من جهاز موثوق.</T>
      </View>
      {st.isLoading ? <Loading /> : st.error ? (
        <Card><T color="error">{(st.error as Error).message}</T></Card>
      ) : !s.enrolled && !s.has_trusted ? (
        <TotpSetup onDone={refresh} />
      ) : s.locked_minutes > 0 ? (
        <Card testID="dev-auth-locked"><T color="error">التحقق مقفل مؤقتاً بسبب محاولات خاطئة. حاول بعد {s.locked_minutes} دقيقة.</T></Card>
      ) : pending && !recovery ? (
        <Card style={{ gap: spacing.sm }} testID="dev-auth-pending">
          <T v="h2">جهاز جديد — بانتظار الموافقة</T>
          <T v="caption">افتح لوحة المطوّر من جهازك الموثوق ← الأمان، وأدخل رمز الموافقة التالي:</T>
          <T testID="device-approve-code" v="title" style={{ textAlign: "center", letterSpacing: 6, writingDirection: "ltr" }}>{pending.code}</T>
          <T v="caption">صالح 10 دقائق. لا تملك جهازاً موثوقاً؟ استخدم رمز استرداد بدلاً من ذلك.</T>
          <Btn small variant="ghost" title="استخدام رمز استرداد" onPress={() => setRecovery(true)} />
        </Card>
      ) : (
        <Card style={{ gap: spacing.md }}>
          {s.pending_state === "denied" && <T color="error">تم رفض طلب هذا الجهاز.</T>}
          <Field
            testID="dev-2fa-code-input"
            label={recovery ? "رمز الاسترداد" : "رمز تطبيق المصادقة (6 أرقام)"}
            keyboardType={recovery ? "default" : "number-pad"}
            autoCapitalize="characters"
            maxLength={recovery ? 20 : 6}
            value={code}
            onChangeText={(t) => setCode(recovery ? t.toUpperCase() : t.replace(/\D/g, ""))}
          />
          <Btn testID="dev-2fa-verify-button" title="تحقق" icon="lock-open-outline" loading={busy} disabled={recovery ? code.length < 10 : code.length !== 6} onPress={verify} />
          <Btn testID="dev-2fa-toggle-recovery" small variant="ghost" title={recovery ? "استخدام تطبيق المصادقة" : "فقدت جوالي — استخدام رمز استرداد"} onPress={() => { setRecovery(!recovery); setCode(""); }} />
        </Card>
      )}
      <Btn testID="dev-auth-logout" variant="ghost" title="تسجيل الخروج" onPress={logout} />
    </ScrollView>
  );
}
