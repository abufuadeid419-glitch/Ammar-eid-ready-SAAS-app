import { useRouter } from "expo-router";
import { View } from "react-native";

import { useAuth } from "@/src/auth";
import { isPro } from "@/src/pro";
import { spacing, useTheme } from "@/src/theme";
import { Btn, Card, Ionicons, T } from "@/src/ui";

const PERKS = ["موزعون وموظفون أكثر", "تقارير أسبوعية وشهرية متقدمة", "تحليل الأرباح عبر الفترات", "اشتراك سنوي مع شهرين مجاناً"];

// Upsell card shown to trial organizations. Opens the existing upgrade flow.
export function ProUpsell({ reason, testID = "pro-upsell-card" }: { reason: string; testID?: string }) {
  const { colors } = useTheme();
  const { user } = useAuth();
  const router = useRouter();
  if (isPro(user?.org)) return null;
  return (
    <Card testID={testID} style={{ gap: spacing.md, backgroundColor: colors.brandTertiary, borderColor: colors.brandSecondary }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        <Ionicons name="rocket-outline" size={22} color={colors.brandPrimary} />
        <T v="label" style={{ flex: 1 }}>الترقية إلى Pro</T>
      </View>
      <T v="caption">{reason}</T>
      <View style={{ gap: spacing.xs }}>
        {PERKS.map((p) => (
          <View key={p} style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
            <Ionicons name="checkmark-circle" size={16} color={colors.success} />
            <T v="caption">{p}</T>
          </View>
        ))}
      </View>
      {user?.role === "OWNER" ? (
        <Btn testID={`${testID}-upgrade-button`} title="عرض خطط Pro" icon="rocket-outline" onPress={() => router.push("/upgrade")} />
      ) : (
        <T v="caption" color="muted">اطلب من مالك المؤسسة الترقية.</T>
      )}
    </Card>
  );
}
