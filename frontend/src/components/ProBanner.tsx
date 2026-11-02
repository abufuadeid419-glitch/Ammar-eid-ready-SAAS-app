import { useRouter } from "expo-router";
import { useEffect } from "react";
import { View } from "react-native";

import { usePro } from "@/src/pro";
import { radius, spacing, useTheme } from "@/src/theme";
import { Btn, Card, Ionicons, T } from "@/src/ui";
import { storage } from "@/src/utils/storage";

const LAST_DAYS = 3;
const LICENSE_WARN_DAYS = 7;

// Owner dashboard banner: last 3 days of the Pro trial, after it expires (Free plan),
// or a paid plan about to lapse. Also opens the full-screen plans page once a day.
export function ProBanner() {
  const router = useRouter();
  const { colors } = useTheme();
  const { org, trial, free, daysLeft, isOwner } = usePro();
  const ending = trial && daysLeft <= LAST_DAYS;

  useEffect(() => {
    if (!isOwner || !(ending || free)) return;
    const key = `plans_shown_${new Date().toISOString().slice(0, 10)}`;
    storage.getItem<boolean>(key, false).then((seen) => {
      if (seen) return;
      storage.setItem(key, true);
      setTimeout(() => router.push("/upgrade"), 800);
    });
  }, [isOwner, ending, free, router]);

  if (!isOwner || !org) return null;
  const licenseEnding = org.plan === "LICENSE" && daysLeft > 0 && daysLeft <= LICENSE_WARN_DAYS;
  if (!ending && !free && !licenseEnding) return null;

  const title = free ? "انتهت تجربة Pro المجانية — الميزات المتقدمة مقفلة" : ending ? `تنتهي تجربة Pro خلال ${daysLeft} ${daysLeft === 1 ? "يوم" : "أيام"}` : `ينتهي اشتراكك خلال ${daysLeft} أيام`;
  return (
    <Card testID="trial-countdown-banner" style={{ gap: spacing.md, backgroundColor: colors.surfaceInverse, borderColor: colors.pro, borderWidth: 1.5 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
        <View style={{ width: 40, height: 40, borderRadius: radius.pill, backgroundColor: colors.pro, alignItems: "center", justifyContent: "center" }}>
          <Ionicons name={free ? "lock-closed" : "hourglass-outline"} size={20} color={colors.onPro} />
        </View>
        <T v="label" style={{ flex: 1, color: colors.onSurfaceInverse }} testID="trial-countdown-title">{title}</T>
      </View>
      <T v="caption" style={{ color: colors.onSurfaceInverse, opacity: 0.8 }}>
        التقارير المتقدمة، تذكير الديون عبر SMS، تتبع الموزعين والمسارات — كلها في Pro. الاشتراك السنوي هو الأوفر.
      </T>
      <Btn testID="trial-countdown-upgrade-button" title={free ? "فتح ميزات Pro" : "قارن الخطط وارتقِ الآن"} icon="diamond-outline" onPress={() => router.push("/upgrade")} />
    </Card>
  );
}
