import { useState } from "react";
import { RefreshControl, ScrollView, View } from "react-native";

import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { AccountButton } from "@/src/components/AccountButton";
import { RecoveryCodes, TotpSetup } from "@/src/components/DevTotp";
import { useApi, useBottomChrome, useMutate } from "@/src/hooks";
import { spacing, useTheme } from "@/src/theme";
import { Badge, Btn, Card, Empty, Field, Header, Loading, Section, T, useToast } from "@/src/ui";

const EVENTS: Record<string, string> = {
  "password.ok": "دخول بكلمة المرور", "password.fail": "كلمة مرور خاطئة", "password.locked": "قفل كلمة المرور",
  "2fa.ok": "تحقق بخطوتين ناجح", "2fa.fail": "رمز مصادقة خاطئ", "2fa.locked": "قفل التحقق بخطوتين", "2fa.enabled": "تفعيل المصادقة",
  "2fa.reset": "إعادة ضبط المصادقة", "2fa.setup_started": "بدء إعداد المصادقة", "2fa.setup.fail": "رمز إعداد خاطئ",
  "recovery.used": "استخدام رمز استرداد", "recovery.fail": "رمز استرداد خاطئ", "recovery.regenerated": "تجديد رموز الاسترداد", "recovery.regen.fail": "رمز خاطئ عند تجديد الرموز",
  "device.pending": "طلب جهاز جديد", "device.approved": "موافقة على جهاز", "device.denied": "رفض جهاز", "device.revoked": "إلغاء جهاز",
  "device.approve_fail": "رمز موافقة خاطئ", "device.revoked_attempt": "محاولة من جهاز ملغى",
  "sessions.revoke_all": "إلغاء كل الجلسات الأخرى", "sessions.revoke_all_including_current": "إلغاء كل الجلسات والأجهزة",
};
const fmtTime = (ms: number) => new Date(ms).toLocaleString("ar", { dateStyle: "short", timeStyle: "short" });

function PendingDevice({ d }: { d: any }) {
  const [code, setCode] = useState("");
  const approve = useMutate<any>("POST", () => `/dev/sec/devices/${d.id}/approve`, "تمت الموافقة على الجهاز");
  const deny = useMutate<any>("POST", () => `/dev/sec/devices/${d.id}/deny`, "تم رفض الجهاز");
  return (
    <Card style={{ gap: spacing.sm }} testID={`pending-device-${d.id}`}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        <T v="label" style={{ flex: 1 }}>{d.label}</T>
        <Badge text="بانتظار الموافقة" tone="warning" />
      </View>
      <T v="caption">أدخل الرمز الظاهر على الجهاز الجديد. إذا لم تكن أنت من يحاول الدخول اضغط رفض فوراً.</T>
      <Field testID="approve-code-input" label="رمز الموافقة" keyboardType="number-pad" maxLength={6} value={code} onChangeText={(t) => setCode(t.replace(/\D/g, ""))} />
      <View style={{ flexDirection: "row", gap: spacing.sm }}>
        <Btn testID="approve-device-button" style={{ flex: 1 }} small title="موافقة" disabled={code.length !== 6} loading={approve.isPending} onPress={() => approve.mutate({ code })} />
        <Btn testID="deny-device-button" style={{ flex: 1 }} small variant="danger" title="رفض" loading={deny.isPending} onPress={() => deny.mutate({})} />
      </View>
    </Card>
  );
}

export function DevSecurity() {
  const { colors } = useTheme();
  const { logout } = useAuth();
  const toast = useToast();
  const bottom = useBottomChrome();
  const status = useApi<any>("/dev/sec/status");
  const devices = useApi<any[]>("/dev/sec/devices", true, 8000);
  const logs = useApi<any[]>("/dev/sec/logs");
  const revoke = useMutate<any>("POST", (b) => `/dev/sec/devices/${b.id}/revoke`, "تم إلغاء الجهاز");
  const [confirmAll, setConfirmAll] = useState(false);
  const [regenCode, setRegenCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [resetting, setResetting] = useState(false);
  const [busy, setBusy] = useState(false);

  const revokeAll = async (include_current: boolean) => {
    setBusy(true);
    try {
      const r = await api<any>("/dev/sec/revoke-all", { method: "POST", body: { include_current } });
      if (include_current) { await logout(); return; }
      toast(`تم إلغاء ${r.revoked_devices} جهاز وكل الجلسات الأخرى`);
      setConfirmAll(false);
      devices.refetch(); logs.refetch();
    } catch (e: any) { toast(e.message, "error"); } finally { setBusy(false); }
  };
  const regen = async () => {
    setBusy(true);
    try { setCodes((await api<any>("/dev/sec/recovery", { method: "POST", body: { code: regenCode } })).recovery_codes); setRegenCode(""); }
    catch (e: any) { toast(e.message, "error"); setRegenCode(""); } finally { setBusy(false); }
  };

  const list = devices.data ?? [];
  const refreshAll = () => { status.refetch(); devices.refetch(); logs.refetch(); };
  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }} testID="dev-security-screen">
      <Header title="الأمان" subtitle="2FA والأجهزة" right={<AccountButton />} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: bottom + spacing.xl, gap: spacing.lg }} keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={devices.isRefetching} onRefresh={refreshAll} tintColor={colors.brandPrimary} />}>
        <Card style={{ gap: spacing.xs }}>
          <View style={{ flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" }}>
            <Badge text="كلمة المرور + 2FA مفعّلة" tone="success" />
            <Badge testID="recovery-left-badge" text={`رموز استرداد متبقية: ${status.data?.recovery_left ?? "…"}`} tone={(status.data?.recovery_left ?? 10) <= 3 ? "warning" : "info"} />
          </View>
          <T v="caption">الجلسة تنتهي تلقائياً بعد 24 ساعة من التحقق، وأي جهاز جديد يحتاج موافقتك من هنا.</T>
        </Card>

        <Section title="الأجهزة">
          {devices.isLoading ? <Loading /> : list.length === 0 ? <Empty icon="phone-portrait-outline" text="لا توجد أجهزة" /> : list.map((d) =>
            d.status === "pending" ? <PendingDevice key={d.id} d={d} /> : (
              <Card key={d.id} style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }} testID={`trusted-device-${d.id}`}>
                <View style={{ flex: 1 }}>
                  <T v="label">{d.label}{d.current ? " (هذا الجهاز)" : ""}</T>
                  {!!d.approved_at && <T v="caption">موثوق منذ {fmtTime(d.approved_at)}</T>}
                </View>
                {!d.current && <Btn testID={`revoke-device-${d.id}`} small variant="danger" title="إلغاء" onPress={() => revoke.mutate({ id: d.id })} />}
              </Card>
            ),
          )}
        </Section>

        <Section title="إلغاء الجلسات والأجهزة">
          <Card style={{ gap: spacing.sm }}>
            <Btn testID="revoke-all-others-button" variant="secondary" icon="log-out-outline" title="إلغاء كل الأجهزة والجلسات الأخرى" loading={busy} onPress={() => revokeAll(false)} />
            {confirmAll ? (
              <>
                <T color="error">سيتم إلغاء كل الأجهزة بما فيها هذا الجهاز وتسجيل خروجك. للعودة ستحتاج كلمة المرور + رمز استرداد. متأكد؟</T>
                <Btn testID="confirm-revoke-everything" variant="danger" title="نعم، ألغِ كل شيء" loading={busy} onPress={() => revokeAll(true)} />
                <Btn small variant="ghost" title="تراجع" onPress={() => setConfirmAll(false)} />
              </>
            ) : (
              <Btn testID="revoke-everything-button" variant="danger" icon="warning-outline" title="طوارئ: إلغاء كل شيء بما فيه هذا الجهاز" onPress={() => setConfirmAll(true)} />
            )}
          </Card>
        </Section>

        <Section title="رموز الاسترداد" hint="تجديدها يلغي كل الرموز القديمة">
          {codes ? <RecoveryCodes codes={codes} onDone={() => { setCodes(null); status.refetch(); }} /> : (
            <Card style={{ gap: spacing.sm }}>
              <Field testID="regen-code-input" label="رمز تطبيق المصادقة الحالي" keyboardType="number-pad" maxLength={6} value={regenCode} onChangeText={(t) => setRegenCode(t.replace(/\D/g, ""))} />
              <Btn testID="regen-recovery-button" small title="إنشاء رموز استرداد جديدة" disabled={regenCode.length !== 6} loading={busy} onPress={regen} />
            </Card>
          )}
        </Section>

        <Section title="تطبيق المصادقة" hint="متاحة خلال 10 دقائق من آخر تحقق">
          {resetting ? <TotpSetup onDone={() => { setResetting(false); refreshAll(); }} /> : (
            <Btn testID="reset-totp-button" variant="secondary" icon="refresh" title="نقل المصادقة إلى جوال جديد" onPress={() => setResetting(true)} />
          )}
        </Section>

        <Section title="سجل محاولات الوصول">
          {logs.isLoading ? <Loading /> : (logs.data ?? []).length === 0 ? <Empty icon="list-outline" text="لا توجد أحداث" /> : (
            <Card style={{ gap: spacing.sm }} testID="access-log-card">
              {(logs.data ?? []).slice(0, 50).map((l, i) => (
                <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                  <Badge text={l.ok ? "✓" : "✕"} tone={l.ok ? "success" : "error"} />
                  <View style={{ flex: 1 }}>
                    <T v="label">{EVENTS[l.event] ?? l.event}</T>
                    <T v="caption">{fmtTime(l.at)}{l.device ? ` · ${l.device}` : ""}</T>
                  </View>
                </View>
              ))}
            </Card>
          )}
        </Section>
      </ScrollView>
    </View>
  );
}
