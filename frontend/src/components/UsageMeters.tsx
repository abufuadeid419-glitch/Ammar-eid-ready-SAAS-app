// Owner: plan usage meters (used / max / %) from GET /api/subscription, plus near-limit upgrade alerts.
import { useRouter } from "expo-router";
import { View } from "react-native";

import { fmtDate, money } from "@/src/api";
import { useApi } from "@/src/hooks";
import { radius, spacing, useTheme } from "@/src/theme";
import { Badge, Btn, Card, Ionicons, T } from "@/src/ui";

export const SUB_STATUS: Record<string, { t: string; tone: "success" | "warning" | "error" | "pro" }> = {
  ACTIVE: { t: "فعّال", tone: "success" }, FREE: { t: "الخطة المجانية", tone: "warning" }, EXPIRED: { t: "منتهٍ", tone: "error" },
  SUSPENDED: { t: "موقوف", tone: "error" }, FROZEN: { t: "مجمّد", tone: "warning" },
};
export const REQ_LABEL: Record<string, string> = {
  PENDING: "قيد الانتظار", UNDER_REVIEW: "قيد المراجعة", NEEDS_INFO: "مطلوب معلومات", APPROVED: "مقبول", REJECTED: "مرفوض", CANCELLED: "ملغى", REFUNDED: "مسترد",
};

export function useSubscription(enabled = true) {
  return useApi<any>("/subscription", enabled);
}

function Meter({ m }: { m: any }) {
  const { colors } = useTheme();
  const tone = m.pct == null ? colors.success : m.pct >= 100 ? colors.error : m.pct >= 80 ? colors.warning : colors.brandPrimary;
  return (
    <View style={{ gap: 4 }} testID={`usage-meter-${m.key}`}>
      <View style={{ flexDirection: "row" }}>
        <T v="caption" style={{ flex: 1 }}>{m.label}</T>
        <T v="caption" testID={`usage-value-${m.key}`}>
          {m.used ?? "—"} / {m.max == null ? "بلا حد" : money(m.max)}{m.max != null && m.used != null ? ` · متبقٍ ${money(Math.max(0, m.max - m.used))}` : ""}
        </T>
      </View>
      <View style={{ height: 8, borderRadius: radius.pill, backgroundColor: colors.surfaceTertiary, overflow: "hidden" }}>
        <View style={{ width: `${m.pct ?? 8}%`, height: "100%", borderRadius: radius.pill, backgroundColor: tone, opacity: m.pct == null ? 0.35 : 1 }} />
      </View>
    </View>
  );
}

// Full subscription card for the plans page: plan, status, dates, payment status, every meter.
export function SubscriptionOverview() {
  const sub = useSubscription();
  const { colors } = useTheme();
  const d = sub.data;
  if (!d) return null;
  const st = SUB_STATUS[d.status] ?? SUB_STATUS.FREE;
  return (
    <Card testID="subscription-overview" style={{ gap: spacing.md, backgroundColor: colors.brandTertiary, borderColor: colors.brandSecondary }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        <View style={{ flex: 1 }}>
          <T v="caption">اشتراكك الحالي</T>
          <T v="h2" testID="subscription-plan-name">{d.status === "ACTIVE" ? d.plan_name ?? d.tier : "Free"}</T>
        </View>
        <Badge testID="subscription-status" text={st.t} tone={st.tone} />
      </View>
      <View style={{ flexDirection: "row", gap: spacing.md }}>
        <View style={{ flex: 1 }}><T v="caption">تاريخ البدء</T><T v="label" testID="subscription-start">{d.started_at ? fmtDate(d.started_at).split(" ")[0] : "—"}</T></View>
        <View style={{ flex: 1 }}><T v="caption">تاريخ الانتهاء</T><T v="label" testID="subscription-end">{d.expires_at && d.status !== "FREE" ? fmtDate(d.expires_at).split(" ")[0] : "—"}</T></View>
      </View>
      {d.last_request && (
        <T v="caption" testID="subscription-payment-status">
          آخر طلب دفع: {d.last_request.ref_code} · {REQ_LABEL[d.last_request.status] ?? d.last_request.status}
          {d.last_request.status === "REJECTED" && d.last_request.note ? ` · السبب: ${d.last_request.note}` : ""}
        </T>
      )}
      <View style={{ gap: spacing.sm }} testID="usage-meters">
        <T v="label">استهلاك الموارد</T>
        {d.meters.map((m: any) => <Meter key={m.key} m={m} />)}
      </View>
    </Card>
  );
}

// Dashboard alert when any resource is ≥80% used (or at the limit), with an upgrade button.
export function UsageAlerts() {
  const sub = useSubscription();
  const router = useRouter();
  const { colors } = useTheme();
  const hot = (sub.data?.meters ?? []).filter((m: any) => m.pct != null && m.pct >= 80);
  if (!hot.length) return null;
  const full = hot.some((m: any) => m.pct >= 100);
  return (
    <Card testID="usage-alert" style={{ gap: spacing.sm, borderColor: full ? colors.error : colors.warning, borderWidth: 1.5 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        <Ionicons name={full ? "alert-circle" : "warning-outline"} size={20} color={full ? colors.error : colors.warning} />
        <T v="label" style={{ flex: 1 }}>{full ? "وصلت إلى الحد الأقصى لخطتك" : "اقتربت من حدود خطتك"}</T>
      </View>
      {hot.map((m: any) => <Meter key={m.key} m={m} />)}
      <T v="caption">قم بالترقية إلى خطة أعلى لزيادة الحدود وفتح المزيد من المميزات.</T>
      <Btn testID="usage-alert-upgrade" title="ترقية الآن" icon="rocket-outline" onPress={() => router.push("/upgrade")} />
    </Card>
  );
}
