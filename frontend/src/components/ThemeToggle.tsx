import { View } from "react-native";

import { applyThemePref, spacing, ThemePref, useThemePref } from "@/src/theme";
import { Segments, T } from "@/src/ui";

// Appearance picker: follow device / light / dark (persisted, applies in real time).
export function ThemeToggle() {
  const pref = useThemePref();
  const change = (p: ThemePref) => applyThemePref(p);
  return (
    <View testID="theme-toggle" style={{ gap: spacing.xs }}>
      <T v="label">المظهر</T>
      <View style={{ marginHorizontal: -spacing.lg }}>
        <Segments value={pref} onChange={change} options={[{ key: "system", label: "تلقائي" }, { key: "light", label: "فاتح" }, { key: "dark", label: "داكن" }]} />
      </View>
    </View>
  );
}
