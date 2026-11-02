import { View } from "react-native";

import { usePro } from "@/src/pro";
import { radius, spacing, useTheme } from "@/src/theme";
import { Ionicons, T } from "@/src/ui";

const ROWS: [string, boolean | string, boolean | string][] = [
  ["المبيعات والفواتير والعملاء", true, true],
  ["التقرير اليومي", true, true],
  ["التقارير الأسبوعية والشهرية", false, true],
  ["تذكير الديون التلقائي عبر SMS", false, true],
  ["ملخص SMS اليومي للمالك", false, true],
  ["تخطيط المسارات وتتبع الموزعين", false, true],
  ["أهداف المبيعات ولوحة المتصدرين", false, true],
  ["عدد الموظفين", "1", "حسب الخطة"],
];

// Hero + Free vs Pro comparison table shown on the plans page.
export function ProComparison() {
  const { colors } = useTheme();
  const { trial, free, daysLeft } = usePro();
  const cell = (v: boolean | string, pro: boolean) =>
    typeof v === "string" ? (
      <T v="caption" style={{ color: pro ? colors.onSurface : colors.muted }}>{v}</T>
    ) : (
      <Ionicons name={v ? "checkmark-circle" : "close-circle-outline"} size={20} color={v ? (pro ? colors.pro : colors.success) : colors.muted} />
    );
  return (
    <View testID="pro-comparison" style={{ gap: spacing.md }}>
      <View testID="pro-hero" style={{ backgroundColor: colors.surfaceInverse, borderRadius: radius.lg, padding: spacing.xl, gap: spacing.sm }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <View style={{ backgroundColor: colors.pro, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 2 }}>
            <T v="label" style={{ color: colors.onPro }}>PRO</T>
          </View>
          <Ionicons name="diamond" size={20} color={colors.pro} />
        </View>
        <T v="title" style={{ color: colors.onSurfaceInverse }} testID="pro-hero-title">
          {free ? "انتهت تجربتك المجانية لـ Pro" : trial ? `باقي ${Math.max(daysLeft, 0)} يوم من تجربة Pro المجانية` : "ارتقِ بأعمالك مع Pro"}
        </T>
        <T style={{ color: colors.onSurfaceInverse, opacity: 0.8 }}>
          {free ? "بياناتك محفوظة. اشترك الآن لإعادة فتح جميع الميزات المتقدمة." : "اشترك قبل انتهاء التجربة لتبقى جميع الميزات مفتوحة دون انقطاع."}
        </T>
      </View>
      <View style={{ borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, overflow: "hidden", backgroundColor: colors.surfaceSecondary }}>
        <View style={{ flexDirection: "row", padding: spacing.md, backgroundColor: colors.surfaceTertiary }}>
          <T v="label" style={{ flex: 2 }}>الميزة</T>
          <T v="label" style={{ flex: 1, textAlign: "center" }}>مجاني</T>
          <T v="label" style={{ flex: 1, textAlign: "center", color: colors.pro }}>Pro</T>
        </View>
        {ROWS.map(([f, a, b], i) => (
          <View key={f} testID={`compare-row-${i}`} style={{ flexDirection: "row", alignItems: "center", padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.divider }}>
            <T style={{ flex: 2 }}>{f}</T>
            <View style={{ flex: 1, alignItems: "center" }}>{cell(a, false)}</View>
            <View style={{ flex: 1, alignItems: "center" }}>{cell(b, true)}</View>
          </View>
        ))}
      </View>
    </View>
  );
}
