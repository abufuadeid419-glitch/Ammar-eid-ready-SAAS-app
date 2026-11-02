import { View } from "react-native";

import { useAuth } from "@/src/auth";
import { radius, spacing, useTheme } from "@/src/theme";
import { Btn, Ionicons, Sheet, T } from "@/src/ui";

// One account = one device: confirm moving the account from the previous device to this one.
export function DeviceConflictSheet() {
  const { conflict, dismissConflict, confirmConflict, busy } = useAuth();
  const { colors } = useTheme();
  return (
    <Sheet
      testID="device-conflict-sheet"
      visible={!!conflict}
      onClose={dismissConflict}
      title="الحساب مفتوح على جهاز آخر"
      footer={
        <View style={{ flexDirection: "row", gap: spacing.sm }}>
          <Btn testID="device-conflict-yes" style={{ flex: 1 }} title="نعم" icon="checkmark" loading={busy} onPress={confirmConflict} />
          <Btn testID="device-conflict-no" style={{ flex: 1 }} variant="secondary" title="لا" onPress={dismissConflict} />
        </View>
      }
    >
      <View style={{ alignItems: "center", gap: spacing.md, paddingVertical: spacing.md }}>
        <View style={{ width: 64, height: 64, borderRadius: radius.pill, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" }}>
          <Ionicons name="phone-portrait-outline" size={30} color={colors.brandPrimary} />
        </View>
        <T v="h2" style={{ textAlign: "center" }} testID="device-conflict-message">
          هل توافق على تسجيل الخروج من الجهاز السابق وفتح الحساب على هذا الجهاز؟
        </T>
        <T v="caption" style={{ textAlign: "center" }}>يمكن استخدام الحساب على جهاز واحد فقط في نفس الوقت.</T>
      </View>
    </Sheet>
  );
}
