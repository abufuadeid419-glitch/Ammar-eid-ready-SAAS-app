import { useRouter } from "expo-router";
import { useEffect } from "react";
import { View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/src/auth";
import { radius, spacing, useTheme } from "@/src/theme";
import { Btn, Ionicons, T } from "@/src/ui";

// Farewell screen shown after logout. Session cleanup runs here, after the
// role screens have unmounted, so nothing renders with a half-cleared user.
export default function Goodbye() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, logout } = useAuth();
  useEffect(() => {
    if (user) logout().catch(() => {});
  }, [user, logout]);
  return (
    <View testID="goodbye-screen" style={{ flex: 1, backgroundColor: colors.surface, paddingTop: insets.top, paddingBottom: insets.bottom + spacing.lg, paddingHorizontal: spacing.xl, justifyContent: "center", gap: spacing.xl }}>
      <Animated.View entering={FadeInDown.duration(500)} style={{ alignItems: "center", gap: spacing.lg }}>
        <View style={{ width: 96, height: 96, borderRadius: radius.pill, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" }}>
          <Ionicons name="heart" size={44} color={colors.brandPrimary} />
        </View>
        <T v="display" style={{ textAlign: "center" }} testID="goodbye-title">شكراً لثقتك بنا</T>
        <T style={{ textAlign: "center", color: colors.onSurfaceSecondary }} testID="goodbye-message">
          تم تسجيل خروجك بأمان. نتمنى لك يوماً موفقاً ونتطلع لرؤيتك مجدداً في النظام الذكي.
        </T>
      </Animated.View>
      <Btn testID="goodbye-login-button" title="تسجيل الدخول مجدداً" icon="log-in-outline" disabled={!!user} onPress={() => router.replace("/login")} />
    </View>
  );
}
