import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";

import { convex } from "@/src/convex";
import { useSyncState } from "@/src/offline";
import { radius, spacing, useTheme } from "@/src/theme";
import { SyncReportSheet } from "@/src/components/SyncReport";
import { IconName, Ionicons, T } from "@/src/ui";

// Small live indicator: cloud connection + offline queue state.
// Shown on the dark header as a compact deep-navy pill with status dot.
export function SyncBadge() {
  const { colors } = useTheme();
  const { pending, failed, online, syncing } = useSyncState();
  const [open, setOpen] = useState(false);
  const [cx, setCx] = useState(() => convex.connectionState().isWebSocketConnected);

  useEffect(() => convex.subscribeToConnectionState((s) => setCx(s.isWebSocketConnected)), []);

  // Six distinct states; problems (conflict / failed) win over transport state so they're never hidden.
  const state = failed.some((f) => f.conflict)
    ? "conflict"
    : failed.length
      ? "failed"
      : !online || !cx
        ? "offline"
        : syncing
          ? "syncing"
          : pending.length
            ? "pending"
            : "synced";
  const look: Record<string, { icon: IconName; color: string; label: string }> = {
    synced: { icon: "cloud-done-outline", color: colors.success, label: "متزامن" },
    offline: { icon: "cloud-offline-outline", color: colors.muted, label: "غير متصل" },
    pending: { icon: "time-outline", color: colors.warning, label: "بانتظار المزامنة" },
    syncing: { icon: "sync-outline", color: colors.info, label: "جارٍ المزامنة" },
    failed: { icon: "alert-circle-outline", color: colors.error, label: "فشل المزامنة" },
    conflict: { icon: "git-compare-outline", color: colors.error, label: "تعارض" },
  };
  const s = look[state];
  const count = state === "failed" || state === "conflict" ? failed.length : pending.length;
  return (
    <>
    <Pressable
      testID="sync-status-badge"
      accessibilityLabel={s.label}
      onPress={() => setOpen(true)}
      hitSlop={6}
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1, width: 36, height: 36, borderRadius: radius.md, backgroundColor: colors.headerDeep, alignItems: "center", justifyContent: "center" })}
    >
      <View testID={`sync-status-${state}`}>
        <Ionicons name={s.icon} size={20} color={state === "offline" ? colors.onHeaderDeep : s.color} />
      </View>
      {count > 0 && state !== "synced" && (
        <View testID="sync-status-count" style={{ position: "absolute", top: -4, left: -4, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: s.color, alignItems: "center", justifyContent: "center", paddingHorizontal: 3 }}>
          <T v="caption" style={{ color: colors.onError, fontSize: 10, lineHeight: 14 }}>{count}</T>
        </View>
      )}
    </Pressable>
    <SyncReportSheet visible={open} onClose={() => setOpen(false)} />
    </>
  );
}
