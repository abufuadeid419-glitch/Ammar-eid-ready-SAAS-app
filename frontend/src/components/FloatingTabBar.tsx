import { BlurView } from "expo-blur";
import React, { useEffect, useState } from "react";
import { Platform, Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import { KeyboardEvents } from "react-native-keyboard-controller";
import Animated, { useAnimatedStyle, withTiming } from "react-native-reanimated";
import { EdgeInsets, useSafeAreaInsets } from "react-native-safe-area-context";

import { fonts, radius, spacing, useTheme } from "@/src/theme";
import { IconName, Ionicons, T } from "@/src/ui";

type BottomTabBarProps = { state: any; descriptors: any; emitter: any; navigateToTab: (key: string) => void };

// Floating pill geometry (shared with useBottomChrome so lists never hide under the bar).
export const FLOAT_BAR_H = 64;
const SIDE = spacing.lg;
// Sits above the system navigation bar (3-button or gesture) with a small visible gap.
export const floatBarBottom = (insets: EdgeInsets) => Math.max(insets.bottom, spacing.sm) + spacing.sm;
// Total space the bar takes from the bottom edge (content padding / floating buttons).
export const floatBarSpace = (insets: EdgeInsets) => floatBarBottom(insets) + FLOAT_BAR_H + spacing.sm;

function TabItem({ focused, icon, label, onPress, onLongPress, testID }: { focused: boolean; icon: IconName; label: string; onPress: () => void; onLongPress: () => void; testID?: string }) {
  const { colors } = useTheme();
  const capsule = useAnimatedStyle(() => ({
    opacity: withTiming(focused ? 1 : 0, { duration: 180 }),
    transform: [{ scale: withTiming(focused ? 1 : 0.88, { duration: 180 }) }],
  }));
  return (
    <Pressable
      testID={testID}
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      aria-selected={focused}
      accessibilityLabel={label}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [styles.item, { opacity: pressed ? 0.7 : 1 }]}
    >
      <Animated.View style={[styles.capsule, { backgroundColor: colors.brandTertiary }, capsule]} />
      <Ionicons name={icon} size={22} color={focused ? colors.brandPrimary : colors.muted} />
      <T numberOfLines={1} style={[styles.label, { color: focused ? colors.brandPrimary : colors.muted, fontFamily: focused ? fonts.bold : fonts.semibold }]}>{label}</T>
    </Pressable>
  );
}

// iOS-style floating glass tab bar used on Android, iOS < 26 and web (iOS 26+ uses NativeTabs).
export function FloatingTabBar({ state, descriptors, emitter, navigateToTab, icons }: BottomTabBarProps & { icons: Record<string, IconName> }) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { colors, scheme } = useTheme();
  const [kb, setKb] = useState(false);

  // Hide while typing so the bar never floats over the keyboard / sticky form buttons.
  useEffect(() => {
    const show = KeyboardEvents.addListener("keyboardWillShow", () => setKb(true));
    const hide = KeyboardEvents.addListener("keyboardDidHide", () => setKb(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  if (kb) return null;

  const barW = Math.min(width - SIDE * 2, 560);
  const glass = Platform.OS === "ios";
  return (
    <View pointerEvents="box-none" style={[styles.wrap, { bottom: floatBarBottom(insets) }]} testID="floating-tab-bar">
      <View
        style={[
          styles.pill,
          {
            width: barW,
            borderColor: colors.borderStrong,
            backgroundColor: glass ? "transparent" : colors.surfaceSecondary,
            ...(Platform.OS === "web" ? ({ boxShadow: `0px 8px 24px ${colors.glow}` } as any) : { shadowColor: colors.brandPrimary }),
          },
        ]}
      >
        {glass && (
          <>
            <BlurView intensity={60} tint={scheme === "dark" ? "dark" : "light"} style={StyleSheet.absoluteFill} />
            <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.surfaceSecondary, opacity: 0.72 }]} />
          </>
        )}
        {state.routes.map((route: any, index: number) => {
          const { options } = descriptors[route.key];
          const focused = state.index === index;
          const onPress = () => {
            const e = emitter.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
            if (!focused && !e.defaultPrevented) navigateToTab(route.key);
          };
          const onLongPress = () => emitter.emit({ type: "tabLongPress", target: route.key });
          return (
            <TabItem
              key={route.key}
              testID={options.tabBarButtonTestID}
              focused={focused}
              icon={icons[route.name] ?? "ellipse-outline"}
              label={String(options.title ?? route.name)}
              onPress={onPress}
              onLongPress={onLongPress}
            />
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 0, right: 0, alignItems: "center" },
  pill: {
    height: FLOAT_BAR_H,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.xs,
    overflow: Platform.OS === "android" ? "visible" : "hidden",
    elevation: 10,
    shadowOpacity: 0.14,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
  },
  item: { flex: 1, height: FLOAT_BAR_H - spacing.sm * 2, alignItems: "center", justifyContent: "center", gap: 2 },
  capsule: { position: "absolute", top: 0, bottom: 0, left: 2, right: 2, borderRadius: radius.pill },
  label: { fontSize: 11, lineHeight: 16 },
});
