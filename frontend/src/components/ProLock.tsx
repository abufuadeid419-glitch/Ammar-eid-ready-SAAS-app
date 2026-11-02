import { useRouter } from "expo-router";
import React from "react";
import { View } from "react-native";

import { hasFeature, usePro } from "@/src/pro";
import { radius, spacing, useTheme } from "@/src/theme";
import { Btn, Card, Ionicons, T } from "@/src/ui";

// Renders children when the company's plan includes `module`; otherwise a locked card that leads to the plans page.
export function ProLock({ feature, module, children, testID }: { feature: string; module: string; children: React.ReactNode; testID: string }) {
  const { org, pro, isOwner } = usePro();
  const { colors } = useTheme();
  const router = useRouter();
  if (hasFeature(org, module)) return <>{children}</>;
  return (
    <Card testID={testID} style={{ gap: spacing.md, borderColor: colors.pro, borderWidth: 1.5 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
        <View style={{ width: 40, height: 40, borderRadius: radius.pill, backgroundColor: colors.pro, alignItems: "center", justifyContent: "center" }}>
          <Ionicons name="lock-closed" size={20} color={colors.onPro} />
        </View>
        <View style={{ flex: 1 }}>
          <T v="label">{feature}</T>
          <T v="caption">{pro ? "هذه الميزة غير مشمولة في خطتك الحالية" : "هذه الميزة متاحة في الخطط المدفوعة فقط"}</T>
        </View>
      </View>
      {isOwner ? (
        <Btn testID={`${testID}-upgrade`} small title="فتح الميزة بترقية الخطة" icon="diamond-outline" onPress={() => router.push("/upgrade")} />
      ) : (
        <T v="caption">اطلب من مالك المؤسسة ترقية الخطة.</T>
      )}
    </Card>
  );
}
