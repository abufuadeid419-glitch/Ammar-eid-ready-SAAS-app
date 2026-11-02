import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import * as SplashScreen from "expo-splash-screen";
import { useEffect, useState } from "react";
import { StyleSheet, Text, View, useWindowDimensions } from "react-native";
import Animated, { Easing, FadeIn, FadeInDown, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { fonts, spacing } from "@/src/theme";

// Brand splash colours stay identical in light and dark mode.
// Dark premium: navy logo glow fading into deep charcoal, champagne-gold accents.
const NAVY = ["#0B1846", "#05081A", "#090A0C"] as const;
const ACCENT = "#D4AF37";
const WHITE = "#FFFFFF";
const MIN_MS = 1800;

// Animated launch screen (logo, name, tagline, progress bar, glowing globe).
// Stays until `ready` and at least MIN_MS, then fades out.
export function AnimatedSplash({ ready }: { ready: boolean }) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [minDone, setMinDone] = useState(false);
  const [gone, setGone] = useState(false);
  const progress = useSharedValue(0);
  const opacity = useSharedValue(1);

  useEffect(() => {
    SplashScreen.hideAsync().catch(() => {});
    progress.value = withTiming(0.85, { duration: MIN_MS, easing: Easing.out(Easing.cubic) });
    const t = setTimeout(() => setMinDone(true), MIN_MS);
    return () => clearTimeout(t);
  }, [progress]);

  useEffect(() => {
    if (!ready || !minDone) return;
    progress.value = withTiming(1, { duration: 250 });
    opacity.value = withTiming(0, { duration: 450 }, (f) => f && runOnJS(setGone)(true));
  }, [ready, minDone, progress, opacity]);

  const bar = useAnimatedStyle(() => ({ width: `${progress.value * 100}%` }));
  const fade = useAnimatedStyle(() => ({ opacity: opacity.value }));
  if (gone) return null;
  const logo = Math.min(width * 0.46, 220);

  return (
    <Animated.View style={[StyleSheet.absoluteFill, fade]} testID="app-splash" pointerEvents={ready && minDone ? "none" : "auto"}>
      <LinearGradient colors={NAVY} locations={[0, 0.45, 1]} style={StyleSheet.absoluteFill} />
      <Image source={require("../../assets/images/splash-globe.png")} style={[styles.globe, { height: width * 0.62 }]} contentFit="cover" />
      <View style={[styles.center, { paddingTop: insets.top, paddingBottom: insets.bottom + width * 0.35 }]}>
        <Animated.View entering={FadeIn.duration(600)}>
          <Image testID="app-splash-logo" source={require("../../assets/images/splash-logo.png")} style={{ width: logo, height: logo }} contentFit="contain" />
        </Animated.View>
        <Animated.View entering={FadeInDown.delay(250).duration(500)} style={{ alignItems: "center" }}>
          <Text style={styles.brand}>
            Smart <Text style={{ color: ACCENT }}>System</Text>
          </Text>
          <Text style={styles.arabic}>النظام الذكي</Text>
          <View style={styles.divider} />
          <Text style={styles.tagAr}>أمان، موثوقية، سرعة</Text>
          <Text style={styles.tagEn}>Security, Reliability, Speed</Text>
        </Animated.View>
        <View style={styles.track} testID="app-splash-progress">
          <Animated.View style={[styles.fill, bar]} />
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  globe: { position: "absolute", left: 0, right: 0, bottom: 0, width: "100%", opacity: 0.9 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.lg, paddingHorizontal: spacing.xl },
  brand: { fontFamily: fonts.bold, fontSize: 36, color: WHITE, writingDirection: "ltr" },
  arabic: { fontFamily: fonts.bold, fontSize: 28, color: WHITE, marginTop: -spacing.xs },
  divider: { width: 40, height: 2, borderRadius: 1, backgroundColor: ACCENT, marginVertical: spacing.md },
  tagAr: { fontFamily: fonts.semibold, fontSize: 16, color: WHITE, opacity: 0.92 },
  tagEn: { fontFamily: fonts.regular, fontSize: 14, color: WHITE, opacity: 0.85, writingDirection: "ltr" },
  track: { width: 160, height: 3, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.15)", overflow: "hidden", marginTop: spacing.md, flexDirection: "row-reverse" },
  fill: { height: 3, borderRadius: 2, backgroundColor: ACCENT },
});
