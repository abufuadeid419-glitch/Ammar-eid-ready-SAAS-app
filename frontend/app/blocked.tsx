import { useRouter } from "expo-router";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/src/auth";
import { SUPPORT_WHATSAPP, openSupport } from "@/src/support";
import { spacing, useTheme } from "@/src/theme";
import { Btn, Empty, T } from "@/src/ui";

export default function Blocked() {
  const { user, logout, refresh } = useAuth();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const status = user?.org?.status;
  const deleted = status === "DELETED";
  const text = deleted
    ? "تم حذف مؤسستك بسبب مخالفة أو عدم الدفع، وتم إيقاف جميع عمليات المؤسسة. الحساب موقوف — يرجى التواصل مع فريق الدعم عبر واتساب."
    : status === "SUSPENDED" ? "تم إيقاف اشتراك المؤسسة. يرجى التواصل مع الدعم." : "انتهى اشتراك المؤسسة. يرجى التجديد للمتابعة.";
  return (
    <View testID="blocked-screen" style={{ flex: 1, justifyContent: "center", padding: spacing.xl, paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.xl, backgroundColor: colors.surface, gap: spacing.md }}>
      <Empty icon={deleted ? "trash-outline" : "lock-closed-outline"} text={text} />
      <T v="caption" style={{ textAlign: "center" }}>{user?.org?.name}</T>
      {deleted && <T testID="blocked-support-number" v="h2" style={{ textAlign: "center", writingDirection: "ltr" }}>{SUPPORT_WHATSAPP}</T>}
      {!deleted && <Btn testID="blocked-support-button" variant="secondary" title="التواصل مع فريق الدعم (واتساب)" icon="logo-whatsapp" onPress={() => openSupport()} />}
      {deleted ? (
        <Btn testID="blocked-whatsapp-button" title="تواصل مع الدعم عبر واتساب" icon="logo-whatsapp" onPress={() => openSupport()} />
      ) : (
        user?.role === "OWNER" && <Btn testID="blocked-upgrade-button" title="تجديد / ترقية الخطة" icon="rocket-outline" onPress={() => router.push("/upgrade")} />
      )}
      <Btn testID="blocked-refresh-button" variant="secondary" title="إعادة التحقق" icon="refresh" onPress={refresh} />
      <Btn testID="blocked-logout-button" variant="ghost" title="تسجيل الخروج" onPress={logout} />
    </View>
  );
}
