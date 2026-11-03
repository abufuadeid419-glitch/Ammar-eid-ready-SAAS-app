import { useMemo, useState } from "react";
import { ScrollView, TextInput, View } from "react-native";

import { fmtDate, money } from "@/src/api";
import { AgentLocationRow } from "@/src/components/AgentLocationRow";
import { AgentMapSheet } from "@/src/components/AgentMapSheet";
import { LeafletMap } from "@/src/components/LeafletMap";
import { leafletHtml } from "@/src/maps";
import { radius, spacing, useTheme } from "@/src/theme";
import { Badge, Card, Chip, Empty, Ionicons, T, toLatinDigits } from "@/src/ui";

// Presentation only: the data (agents, last_location, today_visits) and the map/marker/sheet behaviour are unchanged.
const LIVE_MS = 15 * 60 * 1000;
type Filter = "all" | "live" | "idle" | "none";
const stateOf = (a: any): Filter => (!a.last_location ? "none" : Date.now() - Date.parse(a.last_location.at) <= LIVE_MS ? "live" : "idle");

// All distributors' last positions + today's sale visits (OpenStreetMap, no API key).
export function AgentsMap({ agents }: { agents: any[] }) {
  const { colors } = useTheme();
  const [sel, setSel] = useState<any>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const located = agents.filter((a) => a.last_location);
  const counts = useMemo(() => {
    const c = { all: agents.length, live: 0, idle: 0, none: 0 } as Record<Filter, number>;
    for (const a of agents) c[stateOf(a)]++;
    return c;
  }, [agents]);
  const visits = agents.reduce((n, a) => n + (a.today_visits?.length || 0), 0);
  const sales = agents.reduce((n, a) => n + (a.today_visits || []).reduce((m: number, v: any) => m + (v.total || 0), 0), 0);
  const list = agents
    .filter((a) => filter === "all" || stateOf(a) === filter)
    .filter((a) => !q.trim() || String(a.name ?? a.email ?? "").includes(q.trim()))
    .sort((x, y) => String(y.last_location?.at ?? "").localeCompare(String(x.last_location?.at ?? "")));

  const html = located.length
    ? leafletHtml({
        markers: [
          ...located.flatMap((a) =>
            (a.today_visits ?? []).map((v: any) => ({ lat: v.lat, lng: v.lng, label: `${v.invoice_no} · ${v.customer_name} · ${money(v.total)}`, color: colors.warning, small: true })),
          ),
          ...located.map((a) => ({ id: a.user_id, lat: a.last_location.lat, lng: a.last_location.lng, label: a.name ?? a.email, color: colors.brandPrimary, permanent: true })),
        ],
        zoom: 13,
      })
    : null;

  const STATS: { k: string; v: string; icon: any; tone: string }[] = [
    { k: "متصل الآن", v: String(counts.live), icon: "radio-outline", tone: colors.success },
    { k: "غير متصل", v: String(counts.idle), icon: "time-outline", tone: colors.warning },
    { k: "زيارات اليوم", v: String(visits), icon: "storefront-outline", tone: colors.brandPrimary },
    { k: "مبيعات اليوم", v: money(sales), icon: "cash-outline", tone: colors.brandPrimary },
  ];
  const FILTERS: { key: Filter; label: string }[] = [
    { key: "all", label: `الكل ${counts.all}` }, { key: "live", label: `متصل ${counts.live}` },
    { key: "idle", label: `غير متصل ${counts.idle}` }, { key: "none", label: `بلا موقع ${counts.none}` },
  ];

  return (
    <View style={{ gap: spacing.md }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }} testID="gps-stats">
        {STATS.map((s) => (
          <View key={s.k} style={{ flexGrow: 1, flexBasis: "45%", flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border }}>
            <Ionicons name={s.icon} size={18} color={s.tone} />
            <View style={{ flex: 1 }}>
              <T v="caption" numberOfLines={1}>{s.k}</T>
              <T v="label" numberOfLines={1} testID={`gps-stat-${s.icon}`}>{s.v}</T>
            </View>
          </View>
        ))}
      </View>

      {html ? (
        <View style={{ height: 340, borderRadius: radius.lg, overflow: "hidden", borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary }}>
          <LeafletMap html={html} testID="agents-map" onMarkerPress={(id) => setSel(located.find((a) => a.user_id === id) ?? null)} />
        </View>
      ) : (
        <Empty icon="map-outline" text="لا توجد مواقع مسجلة للموزعين بعد" />
      )}
      <View style={{ flexDirection: "row", gap: spacing.md, alignItems: "center" }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}><View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.brandPrimary }} /><T v="caption">موزع</T></View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}><View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.warning }} /><T v="caption">زيارة بيع اليوم</T></View>
        <T v="caption" style={{ flex: 1, textAlign: "left" }}>اضغط على أي موزع لعرض مساره</T>
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 44, paddingHorizontal: spacing.md, borderRadius: radius.pill, backgroundColor: colors.surfaceTertiary }}>
        <Ionicons name="search" size={16} color={colors.muted} />
        <TextInput testID="gps-search-input" value={q} onChangeText={(t) => setQ(toLatinDigits(t))} placeholder="ابحث عن موزع..." placeholderTextColor={colors.muted}
          style={{ flex: 1, color: colors.onSurface, fontSize: 14, textAlign: "right", paddingVertical: spacing.sm }} />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }} style={{ flexGrow: 0 }} testID="gps-filters">
        {FILTERS.map((f) => <Chip key={f.key} testID={`gps-filter-${f.key}`} label={f.label} selected={filter === f.key} onPress={() => setFilter(f.key)} />)}
      </ScrollView>

      {!list.length && <Empty icon="people-outline" text="لا يوجد موزعون في هذا التصنيف" />}
      {list.map((a) =>
        a.last_location ? (
          <View key={a.user_id} style={{ gap: 4 }}>
            <View style={{ flexDirection: "row", gap: spacing.sm, alignItems: "center" }}>
              <Badge text={stateOf(a) === "live" ? "متصل الآن" : "غير متصل"} tone={stateOf(a) === "live" ? "success" : "warning"} />
            </View>
            <AgentLocationRow a={a} />
          </View>
        ) : (
          <Card key={a.user_id} testID={`agent-nolocation-${a.user_id}`} style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, opacity: 0.8 }}>
            <Ionicons name="location-outline" size={20} color={colors.muted} />
            <View style={{ flex: 1 }}>
              <T v="label">{a.name ?? a.email}</T>
              <T v="caption">لم يُسجَّل أي موقع بعد{a.last_seen ? ` · آخر ظهور ${fmtDate(a.last_seen)}` : ""}</T>
            </View>
            <Badge text="بلا موقع" tone="error" />
          </Card>
        ),
      )}
      <AgentMapSheet agent={sel} onClose={() => setSel(null)} />
    </View>
  );
}
