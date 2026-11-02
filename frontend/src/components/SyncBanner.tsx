import * as Haptics from "expo-haptics";
import { useEffect, useRef, useState } from "react";
import { Platform, Pressable, View } from "react-native";

import { SyncReportSheet } from "@/src/components/SyncReport";
import { onSyncComplete, useSyncState } from "@/src/offline";
import { fonts, spacing, useTheme } from "@/src/theme";
import { Ionicons, T, useToast } from "@/src/ui";

// Threshold for the "تمت المزامنة" toast — only pop it when a meaningful
// backlog landed (avoids noise after single-item syncs).
const TOAST_THRESHOLD = 3;

// Shows connectivity + pending/failed offline actions. Hidden when all is synced.
// Includes a progress indicator for large flushes (thousands of items) and a
// quiet toast + haptic buzz on completion so owners know a reconnect catch-up
// finished.
export function SyncBanner() {
  const { colors } = useTheme();
  const toast = useToast();
  const { pending, failed, online, syncing, progress } = useSyncState();
  const [open, setOpen] = useState(false);
  const [justSynced, setJustSynced] = useState(0);
  // Keep the latest toast fn in a ref so onSyncComplete's one-time subscription
  // can always reach the current provider without re-subscribing per render.
  const toastRef = useRef(toast);
  toastRef.current = toast;
  useEffect(() => {
    let t: any;
    const unsubscribe = onSyncComplete((synced) => {
      setJustSynced(synced);
      clearTimeout(t);
      t = setTimeout(() => setJustSynced(0), 12000);
      if (synced >= TOAST_THRESHOLD) {
        // Small success buzz on native so a connected device *feels* the moment
        // their backlog finally landed. The toast provider also triggers a
        // Success haptic, but running our own here ensures the buzz fires even
        // if the toast is suppressed for any reason (e.g. provider unmounted).
        if (Platform.OS !== "web") {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        }
        toastRef.current(`تمت المزامنة · ${synced} عملية`);
      }
    });
    return () => {
      unsubscribe();
      clearTimeout(t);
    };
  }, []);
  if (online && !pending.length && !failed.length) {
    if (!justSynced) return null;
    return (
      <>
        <Pressable testID="sync-done-banner" onPress={() => setOpen(true)} style={{ backgroundColor: colors.success, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <Ionicons name="checkmark-done-outline" size={18} color={colors.onInfo} />
          <T style={{ flex: 1, color: colors.onInfo, fontFamily: fonts.semibold, fontSize: 13 }}>تمت مزامنة {justSynced} عملية · عرض التقرير</T>
          <Ionicons name="chevron-back" size={16} color={colors.onInfo} />
        </Pressable>
        <SyncReportSheet visible={open} onClose={() => setOpen(false)} />
      </>
    );
  }
  const tone = failed.length ? colors.error : online ? colors.info : colors.warning;
  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  const text = !online
    ? (pending.length ? `بدون اتصال · ${pending.length} عملية بانتظار المزامنة` : "بدون اتصال")
    : syncing && progress.total > 0
      ? `جارِ المزامنة · ${progress.done}/${progress.total} (${pct}%)`
      : syncing
        ? "جارِ المزامنة..."
        : failed.length
          ? `${failed.length} عملية فشلت مزامنتها`
          : `${pending.length} عملية بانتظار المزامنة`;
  return (
    <>
      <Pressable testID="sync-banner" onPress={() => setOpen(true)} style={{ backgroundColor: tone, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, gap: spacing.xs }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <Ionicons name={online ? "sync-outline" : "cloud-offline-outline"} size={18} color={colors.onInfo} />
          <T style={{ flex: 1, color: colors.onInfo, fontFamily: fonts.semibold, fontSize: 13 }}>{text}</T>
          <Ionicons name="chevron-back" size={16} color={colors.onInfo} />
        </View>
        {syncing && progress.total > 0 && (
          <View testID="sync-progress-bar" style={{ height: 3, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.25)", overflow: "hidden" }}>
            <View style={{ width: `${pct}%`, height: 3, backgroundColor: "rgba(255,255,255,0.9)" }} />
          </View>
        )}
      </Pressable>
      <SyncReportSheet visible={open} onClose={() => setOpen(false)} />
    </>
  );
}
