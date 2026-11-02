import { useRouter } from "expo-router";
import { useState } from "react";

import { NotificationBell } from "@/src/components/NotificationBell";
import { SyncBadge } from "@/src/components/SyncBadge";
import { replayTour } from "@/src/components/GuidedTour";
import { FAQ } from "@/src/legal";
import { useSyncState } from "@/src/offline";
import { Pressable, View } from "react-native";

import { api, fmtDate, roleLabel } from "@/src/api";
import { useAuth } from "@/src/auth";
import { useApi, useMutate } from "@/src/hooks";
import { ThemeToggle } from "@/src/components/ThemeToggle";
import { isPro, planLabel } from "@/src/pro";
import { spacing, useTheme } from "@/src/theme";
import { Badge, Btn, Card, IconBtn, Ionicons, Row, Sheet, T, useToast } from "@/src/ui";
import { PasswordField, pwRules } from "@/src/components/PasswordField";

// "Trusted devices": the phones/browsers where this account stays signed in. Revoking one forces
// that device to verify by code again.
function TrustedDevices({ open }: { open: boolean }) {
  const sessions = useApi<any[]>("/auth/sessions", open);
  const revoke = useMutate<any>("DELETE", (d) => `/auth/sessions/${d.device_id}`, "تم تسجيل خروج الجهاز");
  const list = sessions.data ?? [];
  if (!list.length) return null;
  return (
    <Card style={{ padding: 0, overflow: "hidden" }} testID="trusted-devices-card">
      <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md }}>
        <T v="label">الأجهزة الموثوقة</T>
        <T v="caption">تبقى هذه الأجهزة مسجّلة الدخول دون طلب رمز جديد.</T>
      </View>
      {list.map((s: any) => (
        <Row
          key={s.device_id}
          testID={`trusted-device-${s.device_id}`}
          icon={s.platform === "web" ? "desktop-outline" : "phone-portrait-outline"}
          title={s.device}
          subtitle={`آخر استخدام: ${fmtDate(s.last_seen_at)}`}
          right={s.current
            ? <Badge text="هذا الجهاز" tone="success" />
            : <IconBtn testID={`revoke-device-${s.device_id}`} icon="log-out-outline" onPress={() => revoke.mutate(s)} />}
        />
      ))}
    </Card>
  );
}

// Change password: confirm the current one, then choose a new one (other devices get signed out).
function ChangePassword() {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const [cur, setCur] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const rules = pwRules(pw);
  const valid = !!cur && rules.every((r) => r.ok) && pw === pw2;
  const change = useMutate("POST", "/auth/password/change", "تم تغيير كلمة المرور", () => {
    setOpen(false);
    setCur("");
    setPw("");
    setPw2("");
  });
  return (
    <Card style={{ padding: 0, overflow: "hidden" }} testID="change-password-card">
      <Row testID="open-change-password-button" icon="key-outline" title="تغيير كلمة المرور" onPress={() => setOpen(!open)} />
      {open && (
        <View style={{ padding: spacing.lg, paddingTop: 0, gap: spacing.md }}>
          <PasswordField testID="current-password-input" label="كلمة المرور الحالية" value={cur} onChangeText={setCur} />
          <PasswordField testID="new-password-input" label="كلمة المرور الجديدة" value={pw} onChangeText={setPw} />
          <PasswordField testID="confirm-new-password-input" label="تأكيد كلمة المرور الجديدة" value={pw2} onChangeText={setPw2} />
          <View style={{ gap: spacing.xs }}>
            {rules.map((r) => (
              <View key={r.text} style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
                <Ionicons name={r.ok ? "checkmark-circle" : "ellipse-outline"} size={16} color={r.ok ? colors.success : colors.muted} />
                <T v="caption" color={r.ok ? "success" : undefined}>{r.text}</T>
              </View>
            ))}
            {pw2.length > 0 && pw !== pw2 && <T testID="change-password-mismatch" v="caption" color="error">كلمتا المرور غير متطابقتين</T>}
          </View>
          <Btn testID="save-new-password-button" title="حفظ كلمة المرور الجديدة" icon="lock-closed-outline" disabled={!valid} loading={change.isPending} onPress={() => change.mutate({ current: cur, password: pw })} />
        </View>
      )}
    </Card>
  );
}

export function AccountButton() {
  const { user, logout } = useAuth();
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { pending } = useSyncState();
  const [help, setHelp] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const toast = useToast();
  const org = user?.org;
  const initials = (user?.name ?? "؟").trim().slice(0, 1);
  return (
    <>
      <View style={{ flexDirection: "row-reverse", gap: spacing.xs, alignItems: "center" }}>
        <Pressable
          testID="account-button"
          onPress={() => setOpen(true)}
          accessibilityLabel="حسابي"
          hitSlop={6}
          style={({ pressed }) => ({
            width: 36,
            height: 36,
            borderRadius: 18,
            backgroundColor: colors.accent,
            alignItems: "center",
            justifyContent: "center",
            opacity: pressed ? 0.85 : 1,
          })}
        >
          <T v="label" style={{ color: colors.onAccent, fontSize: 14 }} testID="account-initials">{initials}</T>
          {pending.length > 0 && (
            <View testID="account-name-chip" style={{ position: "absolute", top: -2, left: -2, width: 10, height: 10, borderRadius: 5, backgroundColor: colors.warning, borderWidth: 2, borderColor: colors.brandPrimary }}>
              <View testID="account-role-chip" />
            </View>
          )}
          {pending.length === 0 && (
            <>
              {/* Invisible test markers — never use fontSize 0 (Android crashes: "FontSize should be a positive value"). */}
              <View style={{ position: "absolute", width: 0, height: 0 }} testID="account-name-chip" />
              <View style={{ position: "absolute", width: 0, height: 0 }} testID="account-role-chip" />
            </>
          )}
        </Pressable>
        <NotificationBell />
        <SyncBadge />
      </View>
      <Sheet
        testID="account-sheet"
        visible={open}
        onClose={() => setOpen(false)}
        title="حسابي"
        footer={<Btn testID="logout-button" variant="danger" icon="log-out-outline" title="تسجيل الخروج" onPress={() => { setOpen(false); router.replace("/goodbye" as any); }} />}
      >
        <Card style={{ gap: spacing.xs }}>
          <T v="h2" testID="account-name">{user?.name}</T>
          <T v="caption">{user?.email}</T>
          <Badge text={roleLabel(user)} />
        </Card>
        <ThemeToggle />
        {user?.has_password && <ChangePassword />}
        {org && (
          <Card style={{ gap: spacing.xs }}>
            <T v="label">{org.name}</T>
            <View style={{ flexDirection: "row", gap: spacing.sm }}>
              <Badge testID="account-plan-badge" text={planLabel(org)} tone={isPro(org) ? "pro" : "warning"} />
              <Badge text={org.status === "ACTIVE" ? "فعّال" : "موقوف"} tone={org.status === "ACTIVE" ? "success" : "error"} />
            </View>
            <T v="caption">ينتهي الاشتراك: {fmtDate(org.expires_at)}</T>
            {user?.role === "OWNER" && (
              <Btn testID="open-upgrade-button" small title="ترقية الخطة" icon="rocket-outline" style={{ marginTop: spacing.sm }} onPress={() => { setOpen(false); router.push("/upgrade"); }} />
            )}
          </Card>
        )}
        {pending.length > 0 && (
          <T v="caption" color="error" testID="logout-pending-warning">تنبيه: لديك {pending.length} عملية غير متزامنة ستُفقد عند تسجيل الخروج.</T>
        )}
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <Row testID="open-help-button" icon="help-circle-outline" title="مركز المساعدة" onPress={() => setHelp(!help)} />
          <Row testID="replay-tour-button" icon="compass-outline" title="الجولة التعريفية" onPress={() => { setOpen(false); setTimeout(replayTour, 400); }} />
          {help && FAQ.map((f, i) => (
            <View key={i} style={{ paddingHorizontal: spacing.lg, paddingVertical: spacing.sm }}>
              <T v="label">{f.q}</T>
              <T v="caption">{f.a}</T>
            </View>
          ))}
          <Row testID="account-terms-link" icon="document-text-outline" title="شروط الاستخدام" onPress={() => { setOpen(false); router.push("/legal?doc=terms"); }} />
          <Row testID="account-privacy-link" icon="shield-outline" title="سياسة الخصوصية" onPress={() => { setOpen(false); router.push("/legal?doc=privacy"); }} />
        </Card>
        <TrustedDevices open={open} />
        {user?.role !== "DEVELOPER" && (
          confirmDel ? (
            <Card style={{ gap: spacing.sm }}>
              <T color="error">{user?.role === "OWNER" ? "سيتم حذف حسابك والمؤسسة وجميع بياناتها نهائياً، ويُفصل جميع الموظفين. هل أنت متأكد؟" : "سيتم حذف حسابك نهائياً. هل أنت متأكد؟"}</T>
              <Btn testID="confirm-delete-account-button" small variant="danger" title="نعم، احذف حسابي" onPress={async () => {
                try { await api("/auth/account", { method: "DELETE" }); setOpen(false); router.replace("/goodbye" as any); } catch (e: any) { toast(e.message, "error"); }
              }} />
            </Card>
          ) : (
            <Btn testID="delete-account-button" small variant="ghost" title="حذف حسابي" icon="trash-outline" onPress={() => setConfirmDel(true)} />
          )
        )}
      </Sheet>
    </>
  );
}
