import { useState } from "react";
import { Pressable, TextInput, View } from "react-native";

import { fonts, radius, spacing, useTheme } from "@/src/theme";
import { Ionicons, T, toLatinDigits } from "@/src/ui";

// Password input with a show/hide toggle (login + change password).
export function PasswordField({ testID, label, value, onChangeText, onSubmitEditing, autoFocus }: { testID: string; label: string; value: string; onChangeText: (t: string) => void; onSubmitEditing?: () => void; autoFocus?: boolean }) {
  const { colors } = useTheme();
  const [show, setShow] = useState(false);
  return (
    <View style={{ gap: spacing.xs }}>
      <T v="label" color="onSurfaceSecondary">{label}</T>
      <View style={{ minHeight: 50, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary, flexDirection: "row", alignItems: "center" }}>
        <TextInput
          testID={testID}
          value={value}
          onChangeText={(t) => onChangeText(toLatinDigits(t))}
          secureTextEntry={!show}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="password"
          textContentType="password"
          autoFocus={autoFocus}
          returnKeyType="done"
          onSubmitEditing={onSubmitEditing}
          placeholder="••••••••"
          placeholderTextColor={colors.muted}
          style={{ flex: 1, minHeight: 50, paddingHorizontal: spacing.md, fontFamily: fonts.regular, fontSize: 17, color: colors.onSurface, textAlign: "right" }}
        />
        <Pressable testID={`${testID}-toggle`} onPress={() => setShow(!show)} hitSlop={8} style={{ width: 48, height: 50, alignItems: "center", justifyContent: "center" }}>
          <Ionicons name={show ? "eye-off-outline" : "eye-outline"} size={20} color={colors.muted} />
        </Pressable>
      </View>
    </View>
  );
}

export const pwRules = (p: string) => [
  { ok: p.length >= 8, text: "8 أحرف على الأقل" },
  { ok: /\p{L}/u.test(p), text: "تحتوي على حرف" },
  { ok: /\d/.test(p), text: "تحتوي على رقم" },
];
