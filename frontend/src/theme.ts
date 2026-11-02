// Design tokens for this app. Light theme only.Always modify the colors and theme to Dark, Light or Dark and Light according to the design guidelines.
//
// The keys match the "color" block of /app/design_guidelines.json. Fill the
// values from that file (or from the user's brand colors). Keep every key; do
// not add a second theme or colors file; do not write color literals in
// components.
//
// How the names work: a plain key is a background, and its `on` partner is the
// text or icon color that sits on top of it. Always use them as a pair.
//   <View style={{ backgroundColor: colors.brandPrimary }}>
//     <Text style={{ color: colors.onBrandPrimary }}>Continue</Text>
//   </View>
//
// Styling a screen or component: build the sheet with makeStyles so colors
// and layout live together and follow the active scheme:
//   const useStyles = makeStyles((colors) => ({
//     card: { backgroundColor: colors.surfaceSecondary, padding: 16 },
//     title: { color: colors.onSurfaceSecondary, fontSize: 16 },
//   }));
//   function Screen() {
//     const styles = useStyles();
//     return <View style={styles.card}><Text style={styles.title}>Hi</Text></View>;
//   }
// For color props that are not styles (icon color, placeholderTextColor,
// ActivityIndicator) read useTheme().colors inside the component.
// Never call StyleSheet.create with color values at module level; it cannot
// follow the scheme.
//
// To support dark mode later: add `dark` to `themes` with every key filled.
// Nothing else changes; the device setting takes over automatically.
// Feel free to add as many new colors as you need to support the design guidelines.

import { useMemo, useSyncExternalStore } from "react";
import { Appearance, StyleSheet } from "react-native";

import { storage } from "@/src/utils/storage";

export type ColorScheme = "light" | "dark";

// Dark Premium Luxe palette (design_guidelines.json). Gold = brandPrimary, emerald = accent, navy logo = brand.
const light = {
  surface: "#F8F9FA",
  onSurface: "#111216",
  surfaceSecondary: "#FFFFFF",
  onSurfaceSecondary: "#1A1D24",
  surfaceTertiary: "#F0F1F5",
  onSurfaceTertiary: "#282C35",
  surfaceInverse: "#111216",
  onSurfaceInverse: "#FFFFFF",
  brand: "#021041",
  brandPrimary: "#C5A059",
  onBrandPrimary: "#FFFFFF",
  brandSecondary: "#A38346",
  onBrandSecondary: "#FFFFFF",
  brandTertiary: "#F7F2E6",
  onBrandTertiary: "#C5A059",
  accent: "#1A8663",
  onAccent: "#FFFFFF",
  accentSoft: "#E1F2EC",
  onAccentSoft: "#136047",
  success: "#10B981",
  onSuccess: "#FFFFFF",
  warning: "#F59E0B",
  onWarning: "#FFFFFF",
  error: "#EF4444",
  onError: "#FFFFFF",
  info: "#3B82F6",
  onInfo: "#FFFFFF",
  border: "#E4E6EB",
  borderStrong: "#C9CDD6",
  divider: "#F0F1F5",
  muted: "#6B7280",
  onBrand: "#FFFFFF",
  overlay: "rgba(0,0,0,0.5)",
  pro: "#C5A059",
  onPro: "#FFFFFF",
  headerDeep: "#021041",
  onHeaderDeep: "#FFFFFF",
  glow: "rgba(197,160,89,0.28)",
};

export type ThemeColors = typeof light;

const dark: ThemeColors = {
  surface: "#090A0C",
  onSurface: "#FFFFFF",
  surfaceSecondary: "#141519",
  onSurfaceSecondary: "#F0F0F0",
  surfaceTertiary: "#1D1E24",
  onSurfaceTertiary: "#E2E2E2",
  surfaceInverse: "#FFFFFF",
  onSurfaceInverse: "#000000",
  brand: "#021041",
  brandPrimary: "#D4AF37",
  onBrandPrimary: "#000000",
  brandSecondary: "#C5A059",
  onBrandSecondary: "#000000",
  brandTertiary: "#2A271B",
  onBrandTertiary: "#D4AF37",
  accent: "#1A8663",
  onAccent: "#FFFFFF",
  accentSoft: "#103528",
  onAccentSoft: "#1A8663",
  success: "#10B981",
  onSuccess: "#000000",
  warning: "#F59E0B",
  onWarning: "#000000",
  error: "#EF4444",
  onError: "#FFFFFF",
  info: "#3B82F6",
  onInfo: "#FFFFFF",
  border: "#272930",
  borderStrong: "#3F424D",
  divider: "#1D1E24",
  muted: "#8A8E9B",
  onBrand: "#FFFFFF",
  overlay: "rgba(0,0,0,0.7)",
  pro: "#E5C271",
  onPro: "#1A1608",
  headerDeep: "#040608",
  onHeaderDeep: "#FFFFFF",
  glow: "rgba(212,175,55,0.30)",
};

export const defaultScheme = "dark" satisfies ColorScheme;

export const themes: { light: ThemeColors; dark?: ThemeColors } = { light, dark };

// User preference: "system" follows the device; persisted across launches.
export type ThemePref = "system" | "light" | "dark";
export const THEME_PREF_KEY = "theme_pref";

// ---------------------------------------------------------------------------
// Reactive theme store.
//
// We do NOT drive the UI from React Native's `useColorScheme()` /
// `Appearance.setColorScheme()`, because react-native-web does not implement
// `setColorScheme`, so an in-app toggle never propagated there (and even on
// native the override was not guaranteed to re-render instantly). Instead we
// keep the preference in a tiny external store and subscribe every `useTheme()`
// consumer with `useSyncExternalStore`, so flipping the theme updates the whole
// app in real time on every platform.
// ---------------------------------------------------------------------------

// Dark premium is the default look; users can still switch in settings.
let pref: ThemePref = "dark";
const listeners = new Set<() => void>();

function systemScheme(): ColorScheme {
  return Appearance.getColorScheme?.() === "dark" && themes.dark ? "dark" : "light";
}

function resolve(): ColorScheme {
  if ((pref === "light" || pref === "dark") && themes[pref]) return pref;
  return systemScheme();
}

let current: ColorScheme = resolve();

function recompute() {
  const next = resolve();
  current = next;
  // Keep native chrome (status bar, pickers, alerts) in step where supported.
  setColorScheme(pref === "system" ? null : next);
  listeners.forEach((l) => l());
}

// When the user is on "system", follow live OS appearance changes.
Appearance.addChangeListener?.(() => {
  if (pref === "system") recompute();
});

export function applyThemePref(p: ThemePref) {
  pref = p;
  storage.setItem(THEME_PREF_KEY, p);
  recompute();
}

export function getThemePref(): ThemePref {
  return pref;
}

// In-app theme override. Call setColorScheme("dark" | "light") or null to follow
// the device. Optional because react-native-web does not implement it; the
// reactive store above is what actually re-themes the app.
export function setColorScheme(scheme: ColorScheme | null) {
  // RN 0.86 re-reads the device scheme only for the literal "unspecified";
  // null would pin useColorScheme() to null and the app to light.
  Appearance.setColorScheme?.(scheme ?? "unspecified");
}

// Restore the saved preference on launch (then notify consumers).
storage.getItem<ThemePref>(THEME_PREF_KEY, "dark").then((p) => {
  if (p && p !== pref) applyThemePref(p);
});

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
function getSnapshot(): ColorScheme {
  return current;
}

export function useTheme(): { scheme: ColorScheme; colors: ThemeColors } {
  const scheme = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { scheme, colors: themes[scheme] ?? themes.light };
}

// Subscribe to the current preference (for the appearance picker UI).
export function useThemePref(): ThemePref {
  return useSyncExternalStore(subscribe, getThemePref, getThemePref);
}

// Themed StyleSheet: returns a hook that builds the sheet from the active
// scheme's colors and memoizes it until the scheme changes.
export function makeStyles<T extends StyleSheet.NamedStyles<T> | StyleSheet.NamedStyles<any>>(
  factory: (colors: ThemeColors) => T & StyleSheet.NamedStyles<any>,
): () => T {
  return function useStyles(): T {
    const { colors } = useTheme();
    return useMemo(() => StyleSheet.create(factory(colors)), [colors]);
  };
}



export const fonts = { regular: "Cairo", semibold: "Cairo-SemiBold", bold: "Cairo-Bold" };
export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radius = { sm: 8, md: 16, lg: 24, xl: 28, pill: 999 };
