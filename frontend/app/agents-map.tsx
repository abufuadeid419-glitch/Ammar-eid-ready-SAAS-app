import { useQuery } from "convex/react";
import { useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api as cxApi } from "@/convex/_generated/api";
import { money } from "@/src/api";
import { useAuth } from "@/src/auth";
import { AgentsMap } from "@/src/components/AgentsMap";
import { radius, spacing, useTheme } from "@/src/theme";
import { Badge, Card, Empty, Header, IconBtn, Loading, Row, Section, Segments, T, useToast } from "@/src/ui";

const today = () => new Date().toISOString().slice(0, 10);

const STOP_TONE: Record<string, "success" | "warning" | "error"> = {
  VISITED: "success",
  SKIPPED: "error",
  PENDING: "warning",
};
const STOP_LABEL: Record<string, string> = { VISITED: "تمت الزيارة", SKIPPED: "تم التخطي", PENDING: "بالانتظار" };

// Live owner Agent Map — reads agent locations, today's visits and route plans
// straight from Convex (useQuery, real-time). The session is mirrored into
// Convex first so the same bearer token authenticates the Convex functions.
export default function AgentsMapScreen() {
  const { colors } = useTheme();
  const { token, user } = useAuth();
  const toast = useToast();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const ready = true;
  const [tab, setTab] = useState<"map" | "routes">("map");

  const arg = ready && token ? { token } : "skip";
  const agents = useQuery(cxApi.tracking.agents, arg);
  const routes = useQuery(cxApi.routes.list, ready && token ? { token, date: today() } : "skip");
  const kpis = useQuery(cxApi.routes.kpis, ready && token ? { token, days: 7 } : "skip");

  const loading = !ready || agents === undefined;

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }} testID="agents-map-screen">
      <Header
        title="الخريطة الحية للموزعين"
        subtitle="مواقع الموزعين وخطوط السير — مباشرة"
        onBack={() => router.back()}
      />
      <Segments value={tab} onChange={setTab} options={[{ key: "map", label: "الخريطة" }, { key: "routes", label: `خطوط سير اليوم` }]} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: insets.bottom + spacing.xl }}>
        {loading ? (
          <Loading />
        ) : tab === "map" ? (
          <>
            <Card style={{ flexDirection: "row", gap: spacing.sm, alignItems: "center", backgroundColor: colors.brandTertiary }}>
              <View testID="agents-map-live-dot" style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.success }} />
              <T v="caption" style={{ flex: 1 }}>
                {agents.length} موزع · يتحدّث فورياً عند تسجيل موقع أو بيع جديد
              </T>
            </Card>
            <AgentsMap agents={agents} />
          </>
        ) : (
          <>
            {kpis && kpis.agents.length > 0 && (
              <Section title="أداء آخر 7 أيام">
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
                  {kpis.agents.map((a: any) => (
                    <Card key={a.distributor_id} style={{ flexGrow: 1, minWidth: 150, gap: 4 }}>
                      <T v="label">{a.name || "موزع"}</T>
                      <T v="caption" color="muted">{a.routes} خط سير · {a.stops} محطة</T>
                      <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: 4 }}>
                        <Badge text={`زيارة ${a.visit_rate}%`} tone="success" />
                        <Badge text={`تحويل ${a.conversion_rate}%`} tone="brand" />
                      </View>
                    </Card>
                  ))}
                </View>
              </Section>
            )}
            {routes === undefined ? (
              <Loading />
            ) : routes.length === 0 ? (
              <Empty icon="map-outline" text="لا توجد خطوط سير مجدولة لليوم" />
            ) : (
              routes.map((r: any) => (
                <Section key={r.id} title={`${r.distributor_name || "موزع"} · ${(r.stops || []).length} محطة`}>
                  <Card style={{ padding: 0, overflow: "hidden" }}>
                    {(r.stops || []).length === 0 ? (
                      <Empty icon="location-outline" text="لا توجد محطات" />
                    ) : (
                      (r.stops || []).map((s: any, i: number) => (
                        <Row
                          key={s.customer_id}
                          testID={`route-stop-${r.id}-${i}`}
                          icon="location-outline"
                          title={`${i + 1}. ${s.customer_name}`}
                          subtitle={s.address || s.phone || "—"}
                          right={<Badge text={STOP_LABEL[s.status] ?? s.status} tone={STOP_TONE[s.status] ?? "warning"} />}
                        />
                      ))
                    )}
                  </Card>
                  {r.stops?.some((s: any) => s.lat != null) && (
                    <View style={{ height: 1 }} />
                  )}
                </Section>
              ))
            )}
            <T v="caption" color="muted" style={{ textAlign: "center" }}>
              تحديث مباشر · إجمالي زيارات اليوم {agents.reduce((n: number, a: any) => n + (a.today_visits?.length || 0), 0)} · مبيعات{" "}
              {money(agents.reduce((n: number, a: any) => n + (a.today_visits || []).reduce((m: number, v: any) => m + (v.total || 0), 0), 0))}
            </T>
          </>
        )}
      </ScrollView>
    </View>
  );
}
