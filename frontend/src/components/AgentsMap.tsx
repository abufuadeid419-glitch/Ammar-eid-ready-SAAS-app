import { useState } from "react";
import { View } from "react-native";

import { money } from "@/src/api";
import { AgentLocationRow } from "@/src/components/AgentLocationRow";
import { AgentMapSheet } from "@/src/components/AgentMapSheet";
import { LeafletMap } from "@/src/components/LeafletMap";
import { leafletHtml } from "@/src/maps";
import { radius, spacing, useTheme } from "@/src/theme";
import { Empty, T } from "@/src/ui";

// All distributors' last positions + today's sale visits (OpenStreetMap, no API key).
export function AgentsMap({ agents }: { agents: any[] }) {
  const { colors } = useTheme();
  const [sel, setSel] = useState<any>(null);
  const located = agents.filter((a) => a.last_location);
  if (!located.length) return <Empty icon="map-outline" text="لا توجد مواقع مسجلة للموزعين بعد" />;
  const html = leafletHtml({
    markers: [
      ...located.flatMap((a) =>
        (a.today_visits ?? []).map((v: any) => ({ lat: v.lat, lng: v.lng, label: `${v.invoice_no} · ${v.customer_name} · ${money(v.total)}`, color: colors.warning, small: true })),
      ),
      ...located.map((a) => ({ id: a.user_id, lat: a.last_location.lat, lng: a.last_location.lng, label: a.name ?? a.email, color: colors.brandPrimary, permanent: true })),
    ],
    zoom: 13,
  });
  return (
    <View style={{ gap: spacing.md }}>
      <View style={{ height: 320, borderRadius: radius.lg, overflow: "hidden", borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary }}>
        <LeafletMap html={html} testID="agents-map" onMarkerPress={(id) => setSel(located.find((a) => a.user_id === id) ?? null)} />
      </View>
      <T v="caption">اضغط على أي موزع لعرض موقعه ومساره · تحديث تلقائي كل دقيقة</T>
      {located.map((a) => (
        <AgentLocationRow key={a.user_id} a={a} />
      ))}
      <AgentMapSheet agent={sel} onClose={() => setSel(null)} />
    </View>
  );
}
