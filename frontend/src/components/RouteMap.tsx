import { View } from "react-native";

import { LeafletMap } from "@/src/components/LeafletMap";
import { leafletHtml } from "@/src/maps";
import { radius, useTheme } from "@/src/theme";

type Stop = { lat?: number | null; lng?: number | null; customer_name: string; status?: string };

// Route stops as numbered pins joined by a line (OpenStreetMap, no API key).
export function RouteMap({ stops }: { stops: Stop[] }) {
  const { colors } = useTheme();
  const pts = stops
    .map((s, i) => ({ ...s, n: i + 1 }))
    .filter((s) => s.lat != null && s.lng != null) as (Stop & { n: number; lat: number; lng: number })[];
  if (!pts.length) return null;
  const html = leafletHtml({
    markers: pts.map((p) => ({
      lat: p.lat,
      lng: p.lng,
      num: p.n,
      label: `${p.n}. ${p.customer_name}`,
      color: p.status === "VISITED" ? colors.success : p.status === "SKIPPED" ? colors.error : colors.brandPrimary,
    })),
    line: pts.map((p) => [p.lat, p.lng]),
    lineColor: colors.brandPrimary,
  });
  return (
    <View style={{ height: 260, borderRadius: radius.lg, overflow: "hidden", borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary }}>
      <LeafletMap html={html} testID="route-map" />
    </View>
  );
}
