import Ionicons from "@react-native-vector-icons/ionicons";
import * as Haptics from "expo-haptics";
import React, { createContext, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  TextInputProps,
  TextProps,
  View,
  ViewStyle,
} from "react-native";
import Reanimated, { useAnimatedStyle } from "react-native-reanimated";
import { KeyboardAvoidingView, useReanimatedKeyboardAnimation } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { applyThemePref, fonts, makeStyles, radius, spacing, ThemeColors, useTheme } from "@/src/theme";

export type IconName = React.ComponentProps<typeof Ionicons>["name"];
export { Ionicons };

// Arabic-Indic (٠-٩) and Persian (۰-۹) digits → Latin 0-9, plus Arabic decimal/thousands marks,
// so every number the user types works regardless of keyboard language.
export function toLatinDigits(s: string): string {
  return s
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/\u066B/g, ".")
    .replace(/\u066C/g, "");
}

// One-tap light/dark switch shown in every top header.
export function ThemeQuickToggle({ testID = "theme-quick-toggle" }: { testID?: string }) {
  const { scheme } = useTheme();
  return (
    <HeaderIconBtn
      testID={testID}
      icon={scheme === "dark" ? "sunny-outline" : "moon-outline"}
      onPress={() => applyThemePref(scheme === "dark" ? "light" : "dark")}
    />
  );
}

const haptic = () => {
  if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
};

// ---------------- Text ----------------
type Variant = "display" | "title" | "h2" | "body" | "label" | "caption";
const sizes: Record<Variant, { size: number; font: string; lh: number }> = {
  display: { size: 26, font: fonts.bold, lh: 40 },
  title: { size: 22, font: fonts.bold, lh: 34 },
  h2: { size: 17, font: fonts.semibold, lh: 28 },
  body: { size: 15, font: fonts.regular, lh: 24 },
  label: { size: 15, font: fonts.semibold, lh: 24 },
  caption: { size: 13, font: fonts.regular, lh: 20 },
};

export function T({
  v = "body",
  color,
  style,
  ...rest
}: TextProps & { v?: Variant; color?: keyof ThemeColors }) {
  const { colors } = useTheme();
  const s = sizes[v];
  return (
    <Text
      {...rest}
      style={[
        { fontFamily: s.font, fontSize: s.size, lineHeight: s.lh, color: colors[color ?? (v === "caption" ? "muted" : "onSurface")] },
        style,
      ]}
    />
  );
}

// ---------------- Button ----------------
type BtnVariant = "primary" | "secondary" | "danger" | "ghost" | "navy";
export function Btn({
  title,
  onPress,
  variant = "primary",
  icon,
  loading,
  disabled,
  testID,
  style,
  small,
}: {
  title: string;
  onPress: () => void;
  variant?: BtnVariant;
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  testID?: string;
  style?: ViewStyle;
  small?: boolean;
}) {
  const { colors } = useTheme();
  const map = {
    // Primary CTA = champagne gold pill with a soft gold glow (dark premium).
    primary: [colors.brandPrimary, colors.onBrandPrimary],
    secondary: [colors.brandTertiary, colors.onBrandTertiary],
    navy: [colors.brand, colors.onBrand],
    danger: [colors.error, colors.onError],
    ghost: ["transparent", colors.brandPrimary],
  } as const;
  const [bg, fg] = map[variant];
  const shadow: ViewStyle =
    variant === "primary" && !disabled
      ? Platform.OS === "web"
        ? ({ boxShadow: `0px 8px 22px ${colors.glow}` } as ViewStyle)
        : { shadowColor: colors.brandPrimary, shadowOpacity: 0.35, shadowRadius: 14, shadowOffset: { width: 0, height: 8 }, elevation: 4 }
      : {};
  return (
    <Pressable
      testID={testID}
      disabled={disabled || loading}
      onPress={() => {
        haptic();
        onPress();
      }}
      style={({ pressed }) => [
        {
          backgroundColor: bg,
          minHeight: small ? 40 : 52,
          paddingHorizontal: small ? spacing.md : spacing.xl,
          borderRadius: radius.pill,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: spacing.sm,
          opacity: disabled ? 0.5 : pressed ? 0.9 : 1,
          transform: [{ scale: pressed ? 0.98 : 1 }],
        },
        shadow,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <>
          {icon && <Ionicons name={icon} size={small ? 16 : 20} color={fg} />}
          <Text style={{ color: fg, fontFamily: fonts.semibold, fontSize: small ? 14 : 16 }}>{title}</Text>
        </>
      )}
    </Pressable>
  );
}

export function IconBtn({ icon, onPress, testID, tone }: { icon: IconName; onPress: () => void; testID?: string; tone?: "brand" | "plain" }) {
  const { colors } = useTheme();
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        borderRadius: radius.pill,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: tone === "brand" ? colors.brandPrimary : colors.surfaceSecondary,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Ionicons name={icon} size={22} color={tone === "brand" ? colors.onBrandPrimary : colors.onSurface} />
    </Pressable>
  );
}

// ---------------- Card ----------------
export function Card({ children, style, onPress, testID }: { children: React.ReactNode; style?: ViewStyle; onPress?: () => void; testID?: string }) {
  const { colors, scheme } = useTheme();
  const base: ViewStyle = {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    padding: spacing.lg,
    ...(scheme === "light"
      ? Platform.OS === "web"
        ? ({ boxShadow: "0px 4px 14px rgba(0,0,0,0.06)" } as ViewStyle)
        : { shadowColor: colors.onSurface, shadowOpacity: 0.08, shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 2 }
      : { borderWidth: 1, borderColor: colors.border }),
  };
  if (!onPress) return <View testID={testID} style={[base, style]}>{children}</View>;
  return (
    <Pressable testID={testID} onPress={onPress} style={({ pressed }) => [base, style, { opacity: pressed ? 0.9 : 1 }]}>
      {children}
    </Pressable>
  );
}

// ---------------- Field ----------------
export function Field({ label, error, ...props }: TextInputProps & { label: string; error?: string }) {
  const { colors } = useTheme();
  const [focus, setFocus] = useState(false);
  return (
    <View style={{ gap: spacing.xs }}>
      <T v="label" color="onSurfaceSecondary">{label}</T>
      <TextInput
        placeholderTextColor={colors.muted}
        {...props}
        onChangeText={
          props.onChangeText
            ? (t) => props.onChangeText!(/number|decimal|phone|numeric/.test(String(props.keyboardType ?? "")) ? toLatinDigits(t) : t)
            : undefined
        }
        onFocus={(e) => {
          setFocus(true);
          props.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocus(false);
          props.onBlur?.(e);
        }}
        style={{
          minHeight: 50,
          borderRadius: radius.md,
          borderWidth: focus ? 1.5 : 1,
          borderColor: error ? colors.error : focus ? colors.brandPrimary : colors.border,
          backgroundColor: colors.surfaceSecondary,
          paddingHorizontal: spacing.md,
          fontFamily: fonts.regular,
          fontSize: 15,
          color: colors.onSurface,
          textAlign: Platform.OS === "web" ? "right" : undefined,
        }}
      />
      {!!error && <T v="caption" color="error">{error}</T>}
    </View>
  );
}

// ---------------- Header ----------------
// Dark-navy header with large curved bottom corners (reference image).
// Centered title, optional back / right icon buttons, and optional pill-shaped
// segmented tabs rendered INSIDE the dark area (Chats/Status/Calls look).
export function Header<K extends string = string>({
  title,
  subtitle,
  right,
  onBack,
  tabs,
  tabValue,
  onTabChange,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  onBack?: () => void;
  tabs?: { key: K; label: string }[];
  tabValue?: K;
  onTabChange?: (k: K) => void;
}) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  return (
    <View
      style={{
        paddingTop: insets.top + spacing.sm,
        paddingHorizontal: spacing.lg,
        paddingBottom: tabs?.length ? spacing.md : spacing.xl,
        backgroundColor: colors.headerDeep,
        borderBottomLeftRadius: radius.xl,
        borderBottomRightRadius: radius.xl,
        borderBottomWidth: 1,
        borderColor: colors.brandTertiary,
        gap: spacing.md,
        ...(Platform.OS === "web"
          ? ({ boxShadow: `0px 10px 28px ${colors.glow}` } as ViewStyle)
          : { shadowColor: colors.brandPrimary, shadowOpacity: 0.18, shadowRadius: 18, shadowOffset: { width: 0, height: 6 }, elevation: 6 }),
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", minHeight: 44 }}>
        {onBack ? (
          <Pressable
            testID="header-back"
            onPress={onBack}
            hitSlop={8}
            style={({ pressed }) => ({
              width: 36,
              height: 36,
              borderRadius: radius.md,
              backgroundColor: colors.surfaceTertiary,
              alignItems: "center",
              justifyContent: "center",
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Ionicons name="chevron-forward" size={18} color={colors.brandPrimary} />
          </Pressable>
        ) : (
          <View style={{ width: 36 }} />
        )}
        <View style={{ flex: 1, alignItems: "center", paddingHorizontal: spacing.sm }}>
          <Text
            testID="screen-title"
            numberOfLines={1}
            style={{ color: colors.onHeaderDeep, fontFamily: fonts.bold, fontSize: 18 }}
          >
            {title}
          </Text>
          {!!subtitle && (
            <Text
              numberOfLines={1}
              style={{ color: colors.brandSecondary, fontFamily: fonts.regular, fontSize: 12, marginTop: 2 }}
            >
              {subtitle}
            </Text>
          )}
        </View>
        <View testID="header-actions" style={{ flexDirection: "row-reverse", alignItems: "center", gap: spacing.xs, minWidth: 36, justifyContent: "flex-start" }}>
          {right}
          <ThemeQuickToggle />
        </View>
      </View>
      {!!tabs?.length && (
        <View
          style={{
            flexDirection: "row",
            backgroundColor: colors.surfaceTertiary,
            borderRadius: radius.pill,
            padding: 4,
            gap: 2,
          }}
        >
          {tabs.map((t) => {
            const sel = t.key === tabValue;
            return (
              <Pressable
                key={t.key}
                testID={`header-tab-${t.key}`}
                onPress={() => onTabChange?.(t.key)}
                style={{
                  flex: 1,
                  minHeight: 36,
                  borderRadius: radius.pill,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: sel ? colors.brandPrimary : "transparent",
                }}
              >
                <Text
                  style={{
                    color: sel ? colors.onBrandPrimary : colors.muted,
                    fontFamily: fonts.semibold,
                    fontSize: 13,
                  }}
                >
                  {t.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

// Compact dark-header icon button (for Header `right`). White tint, deep-navy pill.
export function HeaderIconBtn({ icon, onPress, testID, badge }: { icon: IconName; onPress: () => void; testID?: string; badge?: number }) {
  const { colors } = useTheme();
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => ({
        width: 36,
        height: 36,
        borderRadius: radius.md,
        backgroundColor: colors.surfaceTertiary,
        alignItems: "center",
        justifyContent: "center",
        opacity: pressed ? 0.75 : 1,
      })}
    >
      <Ionicons name={icon} size={18} color={colors.brandPrimary} />
      {!!badge && badge > 0 && (
        <View
          style={{
            position: "absolute",
            top: -3,
            left: -3,
            minWidth: 16,
            height: 16,
            paddingHorizontal: 4,
            borderRadius: 8,
            backgroundColor: colors.accent,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ color: colors.onAccent, fontFamily: fonts.bold, fontSize: 10 }}>{badge > 9 ? "9+" : badge}</Text>
        </View>
      )}
    </Pressable>
  );
}

// ---------------- FAB ----------------
// Coral round floating action button (bottom-right).
export function FAB({ icon, onPress, testID, bottom }: { icon: IconName; onPress: () => void; testID?: string; bottom?: number }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Pressable
      testID={testID}
      onPress={() => {
        haptic();
        onPress();
      }}
      style={({ pressed }) => ({
        position: "absolute",
        left: spacing.lg,
        bottom: (bottom ?? spacing.lg) + insets.bottom,
        width: 56,
        height: 56,
        borderRadius: 28,
        backgroundColor: colors.brandPrimary,
        alignItems: "center",
        justifyContent: "center",
        opacity: pressed ? 0.9 : 1,
        transform: [{ scale: pressed ? 0.95 : 1 }],
        ...(Platform.OS === "web"
          ? ({ boxShadow: `0px 10px 24px ${colors.glow}` } as ViewStyle)
          : { shadowColor: colors.brandPrimary, shadowOpacity: 0.4, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 6 }),
      })}
    >
      <Ionicons name={icon} size={24} color={colors.onBrandPrimary} />
    </Pressable>
  );
}

// ---------------- Stat ----------------
export function Stat({ label, value, icon, tone = "brand", testID }: { label: string; value: string; icon: IconName; tone?: "brand" | "accent" | "success" | "warning" | "error" | "info"; testID?: string }) {
  const { colors, scheme } = useTheme();
  const c =
    tone === "brand" ? colors.brandPrimary :
    tone === "accent" ? colors.accent :
    colors[tone];
  const soft =
    tone === "brand" ? colors.brandTertiary :
    tone === "accent" ? colors.accentSoft :
    (c + "22");
  return (
    <View
      testID={testID}
      style={{
        flexBasis: "47%",
        flexGrow: 1,
        backgroundColor: colors.surfaceSecondary,
        borderRadius: radius.lg,
        padding: spacing.lg,
        gap: spacing.sm,
        ...(scheme === "light"
          ? Platform.OS === "web"
            ? ({ boxShadow: "0px 4px 14px rgba(0,0,0,0.06)" } as ViewStyle)
            : { shadowColor: colors.onSurface, shadowOpacity: 0.08, shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 2 }
          : { borderWidth: 1, borderColor: colors.border }),
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: soft, alignItems: "center", justifyContent: "center" }}>
          <Ionicons name={icon} size={16} color={c} />
        </View>
        <T v="caption" style={{ flex: 1 }} numberOfLines={1}>{label}</T>
      </View>
      <T v="title" style={{ color: colors.onSurface }} numberOfLines={1} adjustsFontSizeToFit>{value}</T>
    </View>
  );
}

// ---------------- Empty / Loading / Error ----------------
export function Empty({ icon = "file-tray-outline", text, action }: { icon?: IconName; text: string; action?: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <View testID="empty-state" style={{ alignItems: "center", padding: spacing.xxl, gap: spacing.md }}>
      <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" }}>
        <Ionicons name={icon} size={34} color={colors.brandPrimary} />
      </View>
      <T color="muted" style={{ textAlign: "center" }}>{text}</T>
      {action}
    </View>
  );
}

export function Loading() {
  const { colors } = useTheme();
  return (
    <View testID="loading-state" style={{ padding: spacing.xxl, alignItems: "center" }}>
      <ActivityIndicator color={colors.brandPrimary} size="large" />
    </View>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Empty icon="cloud-offline-outline" text={message} action={<Btn testID="retry-button" small title="إعادة المحاولة" onPress={onRetry} icon="refresh" />} />
  );
}

// ---------------- Badge ----------------
export function Badge({ text, tone = "brand", testID }: { text: string; tone?: "brand" | "accent" | "success" | "warning" | "error" | "pro"; testID?: string }) {
  const { colors } = useTheme();
  const bg =
    tone === "brand" ? colors.brandTertiary :
    tone === "accent" ? colors.accentSoft :
    colors[tone];
  const fg =
    tone === "brand" ? colors.onBrandTertiary :
    tone === "accent" ? colors.onAccentSoft :
    colors[`on${tone[0].toUpperCase()}${tone.slice(1)}` as keyof ThemeColors];
  return (
    <View testID={testID} style={{ backgroundColor: bg, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 3, alignSelf: "flex-start" }}>
      <Text style={{ color: fg as string, fontFamily: fonts.semibold, fontSize: 12 }}>{text}</Text>
    </View>
  );
}

// ---------------- Segmented / Chips ----------------
export function Segments<K extends string>({ value, onChange, options }: { value: K; onChange: (k: K) => void; options: { key: K; label: string }[] }) {
  const { colors } = useTheme();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, flexShrink: 0, height: 56 }} contentContainerStyle={{ gap: spacing.sm, paddingHorizontal: spacing.lg, alignItems: "center" }}>
      {options.map((o) => {
        const sel = o.key === value;
        return (
          <Pressable
            key={o.key}
            testID={`segment-${o.key}`}
            onPress={() => onChange(o.key)}
            style={{
              flexShrink: 0,
              height: 36,
              paddingHorizontal: spacing.lg,
              borderRadius: radius.pill,
              justifyContent: "center",
              backgroundColor: sel ? colors.brandPrimary : colors.surfaceSecondary,
              borderWidth: 1,
              borderColor: sel ? colors.brandPrimary : colors.border,
            }}
          >
            <Text style={{ fontFamily: fonts.semibold, fontSize: 14, color: sel ? colors.onBrandPrimary : colors.onSurfaceSecondary }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

// ---------------- Row ----------------
// List row inspired by the reference image: pastel circular avatar (icon or
// text initials), bold title, muted subtitle, optional right-side element,
// soft bottom divider aligned past the avatar.
export function Row({ title, subtitle, right, onPress, testID, icon, avatarText, avatarTone }: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  onPress?: () => void;
  testID?: string;
  icon?: IconName;
  avatarText?: string;
  avatarTone?: "brand" | "accent" | "success" | "warning" | "error" | "info";
}) {
  const { colors } = useTheme();
  const toneBg =
    avatarTone === "accent" ? colors.accentSoft :
    avatarTone === "success" ? colors.success + "22" :
    avatarTone === "warning" ? colors.warning + "22" :
    avatarTone === "error" ? colors.error + "22" :
    avatarTone === "info" ? colors.info + "22" :
    colors.brandTertiary;
  const toneFg =
    avatarTone === "accent" ? colors.accent :
    avatarTone === "success" ? colors.success :
    avatarTone === "warning" ? colors.warning :
    avatarTone === "error" ? colors.error :
    avatarTone === "info" ? colors.info :
    colors.brandPrimary;
  return (
    <Pressable
      testID={testID}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.md,
        paddingVertical: spacing.md,
        paddingHorizontal: spacing.lg,
        backgroundColor: pressed ? colors.surfaceTertiary : colors.surfaceSecondary,
        borderBottomWidth: 1,
        borderBottomColor: colors.divider,
        minHeight: 68,
      })}
    >
      {(icon || avatarText) && (
        <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: toneBg, alignItems: "center", justifyContent: "center" }}>
          {icon ? (
            <Ionicons name={icon} size={20} color={toneFg} />
          ) : (
            <Text style={{ color: toneFg, fontFamily: fonts.bold, fontSize: 15 }}>{(avatarText || "").slice(0, 2)}</Text>
          )}
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.onSurface, fontFamily: fonts.bold, fontSize: 15 }} numberOfLines={1}>{title}</Text>
        {!!subtitle && <Text style={{ color: colors.muted, fontFamily: fonts.regular, fontSize: 13, marginTop: 2 }} numberOfLines={1}>{subtitle}</Text>}
      </View>
      {right}
    </Pressable>
  );
}

// ---------------- Sheet ----------------
export function Sheet({
  visible,
  onClose,
  title,
  children,
  footer,
  testID,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  testID?: string;
}) {
  const styles = useSheetStyles();
  const insets = useSafeAreaInsets();
  // KeyboardAvoidingView (keyboard-controller) lifts the sheet only by the part of the keyboard that
  // actually overlaps it, so it never double-lifts when Android already resized the modal window.
  // The scroll area is plain (no extra keyboard spacer) so the sheet doesn't grow / jump upward.
  const { progress: kbP } = useReanimatedKeyboardAnimation();
  const pad = useAnimatedStyle(() => ({ paddingBottom: insets.bottom * (1 - kbP.value) + spacing.md }));
  return (
    <AppModal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <KeyboardAvoidingView behavior="padding" style={styles.backdrop}>
        <Pressable style={{ flex: 1 }} onPress={onClose} testID="sheet-backdrop" />
        <Reanimated.View testID={testID} style={[styles.sheet, pad]}>
          <View style={styles.handle} />
          <View style={styles.head}>
            <T v="h2" style={{ flex: 1 }}>{title}</T>
            <IconBtn icon="close" onPress={onClose} testID="sheet-close-button" />
          </View>
          <ScrollView style={{ flexGrow: 0, flexShrink: 1 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="none" contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}>
            {children}
          </ScrollView>
          {footer && <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.sm, gap: spacing.sm }}>{footer}</View>}
        </Reanimated.View>
      </KeyboardAvoidingView>
    </AppModal>
  );
}

const useSheetStyles = makeStyles((c) => ({
  backdrop: { flex: 1, backgroundColor: c.overlay },
  sheet: { maxHeight: "90%", backgroundColor: c.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: c.borderStrong, alignSelf: "center", marginTop: spacing.sm },
  head: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
}));

// ---------------- Select (picker) ----------------
export function Select<O>({
  label,
  value,
  placeholder,
  options,
  getLabel,
  getSub,
  onSelect,
  testID,
}: {
  label: string;
  value: string | null;
  placeholder: string;
  options: O[];
  getLabel: (o: O) => string;
  getSub?: (o: O) => string;
  onSelect: (o: O) => void;
  testID?: string;
}) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const filtered = useMemo(() => options.filter((o) => getLabel(o).includes(q)), [options, q, getLabel]);
  const insets = useSafeAreaInsets();
  return (
    <View style={{ gap: spacing.xs }}>
      <T v="label" color="onSurfaceSecondary">{label}</T>
      <Pressable
        testID={testID}
        onPress={() => setOpen(true)}
        style={{ minHeight: 50, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary, paddingHorizontal: spacing.md, flexDirection: "row", alignItems: "center" }}
      >
        <T style={{ flex: 1 }} color={value ? "onSurface" : "muted"} numberOfLines={1}>{value ?? placeholder}</T>
        <Ionicons name="chevron-down" size={18} color={colors.muted} />
      </Pressable>
      <AppModal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)} statusBarTranslucent navigationBarTranslucent>
        <View style={{ flex: 1, backgroundColor: colors.overlay }}>
          <Pressable style={{ flex: 1 }} onPress={() => setOpen(false)} />
          <View style={{ height: "75%", backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingBottom: insets.bottom }}>
            <View style={{ flexDirection: "row", alignItems: "center", padding: spacing.lg, gap: spacing.md }}>
              <T v="h2" style={{ flex: 1 }}>{label}</T>
              <IconBtn icon="close" onPress={() => setOpen(false)} testID="select-close-button" />
            </View>
            <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.sm }}>
              <TextInput
                testID="select-search-input"
                value={q}
                onChangeText={(t) => setQ(toLatinDigits(t))}
                placeholder="بحث..."
                placeholderTextColor={colors.muted}
                style={{ minHeight: 44, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, paddingHorizontal: spacing.md, fontFamily: fonts.regular, color: colors.onSurface, textAlign: Platform.OS === "web" ? "right" : undefined }}
              />
            </View>
            <FlatList
              data={filtered}
              keyExtractor={(_, i) => String(i)}
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={<Empty text="لا توجد نتائج" icon="search-outline" />}
              renderItem={({ item, index }) => (
                <Row
                  testID={`select-option-${index}`}
                  title={getLabel(item)}
                  subtitle={getSub?.(item)}
                  onPress={() => {
                    onSelect(item);
                    setOpen(false);
                    setQ("");
                  }}
                />
              )}
            />
          </View>
        </View>
      </AppModal>
    </View>
  );
}

// ---------------- Toast ----------------
// Toasts live in a tiny global store and are drawn by a ToastHost. The root host sits above the app;
// every Modal (sheets, pickers, tours, full-screen modals) mounts its own host, and only the topmost
// open layer draws the toast — so notifications always appear ABOVE any open modal / bottom sheet.
type ToastT = { msg: string; tone: "success" | "error"; id: number };
let toastState: ToastT | null = null;
let layerStack: number[] = [];
let layerSeq = 0;
const toastSubs = new Set<() => void>();
const emitToast = () => toastSubs.forEach((l) => l());
const subToast = (cb: () => void) => {
  toastSubs.add(cb);
  return () => {
    toastSubs.delete(cb);
  };
};
const getToast = () => toastState;
const getTopLayer = () => layerStack[layerStack.length - 1] ?? 0;

const ToastCtx = createContext<(msg: string, tone?: "success" | "error") => void>(() => {});
export const useToast = () => useContext(ToastCtx);

let hideTimer: any = null;
function showToast(msg: string, tone: "success" | "error" = "success") {
  toastState = { msg, tone, id: Date.now() };
  if (Platform.OS !== "web")
    Haptics.notificationAsync(tone === "success" ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error).catch(() => {});
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    toastState = null;
    emitToast();
  }, 3000);
  emitToast();
}

// Register an overlay layer while `active`; returns this layer's id (0 = root app layer).
function useOverlayLayer(active: boolean) {
  const id = useRef(0);
  if (!id.current) id.current = ++layerSeq;
  useEffect(() => {
    if (!active) return;
    const me = id.current;
    layerStack = [...layerStack, me];
    emitToast();
    return () => {
      layerStack = layerStack.filter((x) => x !== me);
      emitToast();
    };
  }, [active]);
  return id.current;
}

/** Draws the toast when this host belongs to the topmost layer. Mount inside every Modal. */
export function ToastHost({ modal = false }: { modal?: boolean }) {
  const layer = useOverlayLayer(modal);
  const toast = useSyncExternalStore(subToast, getToast, getToast);
  const top = useSyncExternalStore(subToast, getTopLayer, getTopLayer);
  const mine = modal ? top === layer : top === 0;
  const anim = useRef(new Animated.Value(0)).current;
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  useEffect(() => {
    anim.setValue(0);
    if (toast) Animated.spring(anim, { toValue: 1, useNativeDriver: Platform.OS !== "web" }).start();
  }, [toast, anim]);
  if (!toast || !mine) return null;
  return (
    <Animated.View
      testID="toast-message"
      style={{
        pointerEvents: "none",
        position: "absolute",
        top: insets.top + spacing.sm,
        left: spacing.lg,
        right: spacing.lg,
        zIndex: 9999,
        elevation: 30,
        opacity: anim,
        transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-30, 0] }) }],
        backgroundColor: toast.tone === "success" ? colors.surfaceInverse : colors.error,
        borderRadius: radius.md,
        padding: spacing.md,
        flexDirection: "row",
        gap: spacing.sm,
        alignItems: "center",
      }}
    >
      <Ionicons name={toast.tone === "success" ? "checkmark-circle" : "alert-circle"} size={20} color={toast.tone === "success" ? colors.onSurfaceInverse : colors.onError} />
      <Text style={{ flex: 1, color: toast.tone === "success" ? colors.onSurfaceInverse : colors.onError, fontFamily: fonts.semibold, fontSize: 14 }}>{toast.msg}</Text>
    </Animated.View>
  );
}

/** Drop-in RN Modal that always carries its own toast layer on top of its content. */
export function AppModal({ children, ...props }: React.ComponentProps<typeof Modal>) {
  return (
    <Modal {...props}>
      {children}
      {props.visible && <ToastHost modal />}
    </Modal>
  );
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  return (
    <ToastCtx.Provider value={showToast}>
      {children}
      <ToastHost />
    </ToastCtx.Provider>
  );
}

export function Section({ title, hint, children, action }: { title: string; hint?: string; children: React.ReactNode; action?: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: spacing.sm }}>
      <View style={{ flexDirection: "row", alignItems: "flex-end" }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.onSurface, fontFamily: fonts.bold, fontSize: 17 }}>{title}</Text>
          {!!hint && <Text style={{ color: colors.muted, fontFamily: fonts.regular, fontSize: 12, marginTop: 2 }}>{hint}</Text>}
        </View>
        {action}
      </View>
      {children}
    </View>
  );
}
