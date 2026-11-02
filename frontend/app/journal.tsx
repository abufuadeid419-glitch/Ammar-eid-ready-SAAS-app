import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { FlatList, Platform, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { fmtDate, money } from "@/src/api";
import { useApi } from "@/src/hooks";
import { radius, spacing, useTheme } from "@/src/theme";
import { Card, Empty, ErrorBox, Header, IconBtn, Ionicons, Loading, T, useToast } from "@/src/ui";

// Detailed accounting journal (owner + read-only accountant): every document with its lines,
// payment details and suggested debit/credit accounts, exportable as CSV for external accounting software.
const PERIODS = [
  { key: "today", label: "اليوم", days: 0 },
  { key: "7", label: "7 أيام", days: 7 },
  { key: "30", label: "30 يوماً", days: 30 },
  { key: "all", label: "الكل", days: -1 },
] as const;

const rangeFor = (k: string) => {
  const p = PERIODS.find((x) => x.key === k)!;
  if (p.days < 0) return "";
  const d = new Date();
  if (p.days === 0) d.setHours(0, 0, 0, 0);
  else d.setDate(d.getDate() - p.days);
  return `?from=${encodeURIComponent(d.toISOString())}`;
};

const csvCell = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;
function toCsv(entries: any[]) {
  const head = ["التاريخ", "نوع المستند", "الرقم", "الطرف", "بواسطة", "المبلغ", "الحساب المدين", "الحساب الدائن", "المادة", "الكمية", "الوحدة", "عدد القطع", "السعر", "إجمالي السطر", "تفاصيل"];
  const rows: any[][] = [];
  for (const e of entries) {
    const det = Object.entries(e.details ?? {}).filter(([, v]) => v !== "" && v != null).map(([k, v]) => `${k}: ${v}`).join(" | ");
    const base = [fmtDate(e.date), e.type_label, e.ref, e.party, e.by ?? "", e.amount, e.debit_account, e.credit_account];
    if (!e.lines?.length) rows.push([...base, "", "", "", "", "", "", det]);
    else e.lines.forEach((l: any, i: number) => rows.push([...(i === 0 ? base : base.map((x, j) => (j < 4 ? x : ""))), l.product, l.quantity, l.unit, l.pieces, l.price ?? "", l.total ?? "", i === 0 ? det : ""]));
  }
  return "\uFEFF" + [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\n");
}

const DETAIL_LABELS: Record<string, string> = {
  subtotal: "المجموع قبل الخصم", discount: "الخصم", discount_type: "نوع الخصم", paid: "المدفوع", remaining: "المتبقي", payment_type: "طريقة الدفع", voided: "ملغاة", void_reason: "سبب الإلغاء",
  notes: "ملاحظات", input: "المبلغ المدخل", input_currency: "عملة الإدخال", exchange_rate: "سعر الصرف", reason: "السبب", unit_cost: "تكلفة الوحدة", piece_cost: "تكلفة القطعة", status: "الحالة",
};

function Entry({ e, i }: { e: any; i: number }) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const details = Object.entries(e.details ?? {}).filter(([, v]) => v !== "" && v != null && v !== false);
  return (
    <Pressable testID={`journal-entry-${i}`} onPress={() => setOpen(!open)} style={{ backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, gap: spacing.xs, borderWidth: 1, borderColor: colors.border }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        <View style={{ flex: 1 }}>
          <T v="label">{e.type_label}{e.ref ? ` · ${e.ref}` : ""}</T>
          <T v="caption">{fmtDate(e.date)} · {e.party}{e.by ? ` · ${e.by}` : ""}</T>
        </View>
        <T v="label" color={e.details?.voided ? "muted" : "onSurface"}>{money(e.amount)}</T>
        <Ionicons name={open ? "chevron-up" : "chevron-down"} size={18} color={colors.muted} />
      </View>
      {open && (
        <View style={{ gap: spacing.xs, paddingTop: spacing.xs }} testID={`journal-entry-details-${i}`}>
          <T v="caption">مدين: {e.debit_account}</T>
          <T v="caption">دائن: {e.credit_account}</T>
          {details.map(([k, v]) => <T key={k} v="caption">{DETAIL_LABELS[k] ?? k}: {typeof v === "number" ? money(v) : v === true ? "نعم" : String(v)}</T>)}
          {e.lines?.map((l: any, j: number) => (
            <T key={j} v="caption">• {l.product}: {money(l.quantity)} {l.unit}{l.pieces !== l.quantity ? ` (${money(l.pieces)} قطعة)` : ""}{l.price != null ? ` × ${money(l.price)}` : ""}{l.total != null ? ` = ${money(l.total)}` : ""}</T>
          ))}
        </View>
      )}
    </Pressable>
  );
}

export default function Journal() {
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const [period, setPeriod] = useState<string>("30");
  const [type, setType] = useState<string>("ALL");
  const q = useApi<any>(`/accounting/journal${rangeFor(period)}`);
  const entries = useMemo(() => (q.data?.entries ?? []).filter((e: any) => type === "ALL" || e.type === type).slice().reverse(), [q.data, type]);
  const types = [{ type: "ALL", label: "الكل" }, ...(q.data?.totals ?? [])];

  const exportCsv = async () => {
    if (!entries.length) return toast("لا توجد حركات للتصدير", "error");
    const csv = toCsv(entries.slice().reverse());
    const name = `journal-${new Date().toISOString().slice(0, 10)}.csv`;
    try {
      if (Platform.OS === "web") {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
        a.download = name;
        a.click();
        return;
      }
      const f = new File(Paths.cache, name);
      if (f.exists) f.delete();
      f.create();
      f.write(csv);
      await Sharing.shareAsync(f.uri, { mimeType: "text/csv", dialogTitle: name, UTI: "public.comma-separated-values-text" });
    } catch (e: any) {
      toast(e?.message ?? "تعذر التصدير", "error");
    }
  };

  const chip = (key: string, label: string, sel: boolean, onPress: () => void, id: string) => (
    <Pressable key={key} testID={id} onPress={onPress} style={{ flexShrink: 0, height: 36, paddingHorizontal: spacing.md, borderRadius: radius.pill, justifyContent: "center", borderWidth: 1, borderColor: sel ? colors.brandPrimary : colors.border, backgroundColor: sel ? colors.brandTertiary : colors.surfaceSecondary }}>
      <T v="caption" color={sel ? "brandPrimary" : "onSurfaceSecondary"}>{label}</T>
    </Pressable>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }} testID="journal-screen">
      <Header title="دفتر اليومية التفصيلي" subtitle="كل الحركات بالتفصيل للترحيل إلى برنامج المحاسبة" onBack={() => router.back()} right={<IconBtn testID="journal-export-csv-button" icon="download-outline" tone="brand" onPress={exportCsv} />} />
      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ height: 56, flexGrow: 0 }} contentContainerStyle={{ gap: spacing.sm, paddingHorizontal: spacing.lg, alignItems: "center" }}>
          {PERIODS.map((p) => chip(p.key, p.label, period === p.key, () => setPeriod(p.key), `journal-period-${p.key}`))}
        </ScrollView>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ height: 56, flexGrow: 0 }} contentContainerStyle={{ gap: spacing.sm, paddingHorizontal: spacing.lg, alignItems: "center" }}>
          {types.map((t: any) => chip(t.type, t.type === "ALL" ? "كل الأنواع" : `${t.label} (${t.count})`, type === t.type, () => setType(t.type), `journal-type-${t.type.toLowerCase()}`))}
        </ScrollView>
      </View>
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox message={(q.error as Error).message} onRetry={q.refetch} />
      ) : (
        <FlatList
          data={entries}
          keyExtractor={(e, i) => `${e.type}-${e.ref}-${e.date}-${i}`}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm, paddingBottom: insets.bottom + spacing.xl }}
          ListHeaderComponent={
            <Card style={{ gap: spacing.xs, marginBottom: spacing.sm }} testID="journal-totals">
              <T v="label">ملخص الفترة ({entries.length} حركة)</T>
              {(q.data?.totals ?? []).map((t: any) => <T key={t.type} v="caption">{t.label}: {t.count} · {money(t.amount)}</T>)}
            </Card>
          }
          ListEmptyComponent={<Empty icon="document-text-outline" text="لا توجد حركات في هذه الفترة" />}
          renderItem={({ item, index }) => <Entry e={item} i={index} />}
          refreshing={q.isRefetching}
          onRefresh={q.refetch}
        />
      )}
    </View>
  );
}
