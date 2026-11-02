import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";

import { fmtDate } from "@/src/api";
import { clearSyncHistory, discardFailed, retryFailed, syncQueue, useSyncState } from "@/src/offline";
import { radius, spacing, useTheme } from "@/src/theme";
import { Btn, Row, Sheet, T } from "@/src/ui";

type Tab = "pending" | "failed" | "synced";

// Distributor sync report: what is still waiting, what failed (retry / discard) and what already
// reached the server (with when it was recorded offline vs. when it synced).
export function SyncReportSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { colors } = useTheme();
  const { pending, failed, history, lastSyncAt, online, syncing, progress } = useSyncState();
  const [tab, setTab] = useState<Tab | null>(null);
  const cur: Tab = tab ?? (failed.length ? "failed" : pending.length ? "pending" : "synced");
  const tabs: { key: Tab; label: string; count: number; color: string }[] = [
    { key: "pending", label: "بانتظار المزامنة", count: pending.length, color: colors.warning },
    { key: "failed", label: "فشلت", count: failed.length, color: colors.error },
    { key: "synced", label: "تمت مزامنتها", count: history.length, color: colors.success },
  ];
  return (
    <Sheet
      testID="sync-sheet"
      visible={visible}
      onClose={onClose}
      title="تقرير المزامنة"
      footer={<Btn testID="sync-now-button" title={online ? "مزامنة الآن" : "لا يوجد اتصال — ستتم المزامنة تلقائياً"} icon="sync-outline" loading={syncing} disabled={!online || (!pending.length && !syncing)} onPress={syncQueue} />}
    >
      <View style={{ gap: spacing.xs }} testID="sync-report-status">
        <T v="label" color={online ? "success" : "warning"}>{online ? "متصل بالخادم" : "بدون اتصال — العمليات تُحفظ على الجهاز"}</T>
        <T v="caption" testID="sync-last-time">{lastSyncAt ? `آخر مزامنة: ${fmtDate(lastSyncAt)}` : history[0] ? `آخر مزامنة: ${fmtDate(history[0].synced_at)}` : "لم تتم أي مزامنة بعد"}</T>
        {syncing && progress.total > 0 && <T v="caption" color="info" testID="sync-progress-text">قيد المعالجة الآن: {progress.done} من أصل {progress.total}</T>}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ gap: spacing.sm }}>
        {tabs.map((t) => {
          const sel = cur === t.key;
          return (
            <Pressable key={t.key} testID={`sync-tab-${t.key}`} onPress={() => setTab(t.key)} style={{ flexShrink: 0, height: 36, paddingHorizontal: spacing.md, borderRadius: radius.pill, flexDirection: "row", alignItems: "center", gap: spacing.xs, borderWidth: 1, borderColor: sel ? t.color : colors.border, backgroundColor: sel ? colors.surfaceSecondary : colors.surface }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: t.color }} />
              <T v="caption" color={sel ? "onSurface" : "muted"}>{t.label} ({t.count})</T>
            </Pressable>
          );
        })}
      </ScrollView>

      {cur === "pending" &&
        (pending.length ? (
          pending.map((p) => (
            <Row key={p.id} testID={`pending-item-${p.id}`} icon="time-outline" title={p.label} subtitle={`سُجّلت ${fmtDate(p.created_at)}${(p.attempts ?? 0) > 0 ? ` · محاولة ${p.attempts}/5` : ""}`} />
          ))
        ) : (
          <T testID="sync-pending-empty" v="caption">لا توجد عمليات بانتظار المزامنة</T>
        ))}

      {cur === "failed" &&
        (failed.length ? (
          failed.map((f) => (
            <View key={f.id} testID={`failed-item-${f.id}`} style={{ gap: spacing.xs, paddingVertical: spacing.sm }}>
              <T v="label">{f.conflict ? "تعارض · " : ""}{f.label}</T>
              <T testID={`failed-reason-${f.id}`} v="caption" color="error">{f.error ?? "فشل"}</T>
              <T v="caption">سُجّلت {fmtDate(f.created_at)}</T>
              <View style={{ flexDirection: "row", gap: spacing.xs }}>
                <Btn small variant="secondary" title="إعادة" testID={`retry-failed-${f.id}`} onPress={() => retryFailed(f.id)} />
                <Btn small variant="ghost" title="تجاهل" testID={`discard-failed-${f.id}`} onPress={() => discardFailed(f.id)} />
              </View>
            </View>
          ))
        ) : (
          <T testID="sync-failed-empty" v="caption">لا توجد عمليات فاشلة</T>
        ))}

      {cur === "synced" &&
        (history.length ? (
          <>
            {history.map((h) => (
              <Row key={h.id} testID={`synced-item-${h.id}`} icon="checkmark-circle-outline" title={h.label} subtitle={`سُجّلت ${fmtDate(h.created_at)} · وصلت للخادم ${fmtDate(h.synced_at)}`} />
            ))}
            <Btn testID="sync-clear-history-button" small variant="ghost" icon="trash-outline" title="مسح سجل المزامنة" onPress={clearSyncHistory} />
          </>
        ) : (
          <T testID="sync-synced-empty" v="caption">لم تتم مزامنة أي عملية بعد</T>
        ))}
    </Sheet>
  );
}
