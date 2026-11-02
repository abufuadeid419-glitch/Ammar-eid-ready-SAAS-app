import { useMutation } from "convex/react";

import { useApi } from "@/src/hooks";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { api as cxApi } from "@/convex/_generated/api";
import { fmtDate } from "@/src/api";
import { useAuth } from "@/src/auth";
import { fonts, radius, spacing, useTheme } from "@/src/theme";
import { Empty, Ionicons, IconName, Sheet, T } from "@/src/ui";

const icons: Record<string, IconName> = {
  low_stock: "warning-outline",
  out_of_stock: "alert-circle-outline",
  delivery: "car-outline",
  delivery_confirmed: "checkmark-done-outline",
  delivery_rejected: "close-circle-outline",
  stock_request: "file-tray-full-outline",
  warehouse_return: "arrow-undo-outline",
  warehouse_return_accepted: "checkmark-done-outline",
  warehouse_return_rejected: "close-circle-outline",
  debt_digest: "calendar-outline",
  upgrade: "rocket-outline",
  target: "flag-outline",
};

// Real-time notification bell. Styled as a deep-navy pill for the dark header.
export function NotificationBell() {
  const { colors } = useTheme();
  const { token } = useAuth();
  const [open, setOpen] = useState(false);
  const q = useApi<any>("/notifications", !!token, 30000).data; // REST: a failed query must never crash the screen
  const readAll = useMutation(cxApi.notifications.readAll);
  const unread = q?.unread ?? 0;
  const items = q?.items ?? [];

  const openSheet = () => {
    setOpen(true);
    if (unread && token) readAll({ token }).catch(() => {});
  };

  return (
    <>
      <Pressable
        testID="notifications-button"
        onPress={openSheet}
        hitSlop={6}
        style={({ pressed }) => ({
          width: 36,
          height: 36,
          borderRadius: radius.md,
          backgroundColor: colors.headerDeep,
          alignItems: "center",
          justifyContent: "center",
          opacity: pressed ? 0.75 : 1,
        })}
      >
        <Ionicons name="notifications-outline" size={18} color={colors.onHeaderDeep} />
        {unread > 0 && (
          <View
            testID="notifications-unread-badge"
            style={{ pointerEvents: "none", position: "absolute", top: -4, left: -4, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 }}
          >
            <Text style={{ color: colors.onAccent, fontFamily: fonts.bold, fontSize: 11, lineHeight: 14 }}>{unread > 9 ? "9+" : unread}</Text>
          </View>
        )}
      </Pressable>
      <Sheet testID="notifications-sheet" visible={open} onClose={() => setOpen(false)} title="الإشعارات">
        {!items.length ? (
          <Empty icon="notifications-off-outline" text="لا توجد إشعارات" />
        ) : (
          items.map((n: any) => (
            <View key={n.id} testID={`notification-${n.id}`} style={{ flexDirection: "row", gap: spacing.md, alignItems: "flex-start" }}>
              <Ionicons name={icons[n.type] ?? "notifications-outline"} size={22} color={n.read ? colors.muted : colors.brandPrimary} />
              <View style={{ flex: 1 }}>
                <T v="label">{n.title}</T>
                <T v="caption">{n.body}</T>
                <T v="caption">{fmtDate(n.created_at)}</T>
              </View>
            </View>
          ))
        )}
      </Sheet>
    </>
  );
}
