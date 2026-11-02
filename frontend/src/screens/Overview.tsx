import { useRouter } from "expo-router";
import { useState } from "react";
import { RefreshControl, ScrollView, View } from "react-native";

import { money } from "@/src/api";
import { useAuth } from "@/src/auth";
import { AccountButton } from "@/src/components/AccountButton";
import { LocationCard } from "@/src/components/LocationCard";
import { AlertsCard } from "@/src/components/AlertsCard";
import { Leaderboard } from "@/src/components/Leaderboard";
import { StaleDebtorsCard } from "@/src/components/StaleDebtors";
import { MyRoute } from "@/src/components/MyRoute";
import { OwnerOnboarding } from "@/src/components/OwnerOnboarding";
import { PendingDeliveries } from "@/src/components/PendingDeliveries";
import { AgentStock } from "@/src/components/StockRequests";
import { SyncBanner } from "@/src/components/SyncBanner";
import { MyTargetCard, SalesTargetsCard } from "@/src/components/SalesTargets";
import { ProBanner } from "@/src/components/ProBanner";
import { ProLock } from "@/src/components/ProLock";
import { useApi, useBottomChrome } from "@/src/hooks";
import { queryClient } from "@/src/query-client";
import { spacing, useTheme } from "@/src/theme";
import { Badge, Btn, Card, Empty, ErrorBox, Header, Loading, Row, Section, Stat, T } from "@/src/ui";

type OwnerTab = "home" | "alerts" | "performance";

export default function Overview() {
  const { user } = useAuth();
  const router = useRouter();
  const { colors } = useTheme();
  const bottom = useBottomChrome();
  const isAgent = user?.employee_type === "FIELD_AGENT";
  const isOwner = user?.role === "OWNER";
  const stats = useApi<any>("/stats/overview");
  const inv = useApi<any[]>("/my/inventory", isAgent);
  const s = stats.data;

  // Pill-tab switcher inside the dark header (owner / accountant only). Agents
  // keep the single-scroll layout because their key cards (location, target,
  // route, stock) are flow-dependent and tabbing hides important context.
  const [tab, setTab] = useState<OwnerTab>("home");
  const useTabs = !isAgent;
  const tabs: { key: OwnerTab; label: string }[] = useTabs
    ? [
        { key: "home", label: "الرئيسية" },
        { key: "alerts", label: "التنبيهات" },
        { key: "performance", label: "الأداء" },
      ]
    : [];

  // Compact alert count badge for the "التنبيهات" pill (helps owners notice
  // things even when they're on a different tab).
  const alertCount =
    (s?.low_stock?.length ?? 0) + (s?.stale_debtors_count ?? 0) + (s?.pending_deliveries_count ?? 0);

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }} testID="overview-screen">
      <Header
        title={`مرحباً، ${user?.name?.split(" ")[0] ?? ""}`}
        subtitle={user?.org?.name}
        right={<AccountButton />}
        tabs={useTabs ? tabs : undefined}
        tabValue={useTabs ? tab : undefined}
        onTabChange={useTabs ? (k) => setTab(k as OwnerTab) : undefined}
      />
      <SyncBanner />
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.xl, paddingBottom: bottom + spacing.xl }}
        refreshControl={<RefreshControl refreshing={stats.isRefetching} onRefresh={() => { stats.refetch(); inv.refetch(); queryClient.invalidateQueries(); }} tintColor={colors.brandPrimary} />}
      >
        {stats.isLoading ? (
          <Loading />
        ) : stats.error ? (
          <ErrorBox message={(stats.error as Error).message} onRetry={stats.refetch} />
        ) : (
          <>
            {/* ─── HOME TAB (or agent single-scroll) ───────────────────────── */}
            {(!useTabs || tab === "home") && (
              <>
                {isOwner && <ProBanner />}
                {isOwner && <OwnerOnboarding />}
                {isAgent && <LocationCard />}
                {isAgent && <MyTargetCard />}
                {!isAgent && (
                  <Btn testID="open-reports-button" variant="secondary" icon="bar-chart-outline" title="التقارير اليومية والأسبوعية والشهرية" onPress={() => router.push("/reports")} />
                )}
                {!isAgent && (
                  <Btn testID="open-journal-button" variant="secondary" icon="document-text-outline" title="دفتر اليومية التفصيلي (لبرنامج المحاسبة)" onPress={() => router.push("/journal" as any)} />
                )}
                {user?.employee_type === "ACCOUNTANT" && <T v="caption" testID="acct-readonly-note">حساب المحاسب للعرض فقط — لا يمكن الإضافة أو التعديل أو الإلغاء.</T>}
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.md }}>
                  <Stat testID="stat-today-sales" label="مبيعات اليوم" value={money(s.today_sales)} icon="today-outline" tone="accent" />
                  <Stat testID="stat-total-sales" label={isAgent ? "إجمالي مبيعاتي" : "إجمالي المبيعات"} value={money(s.sales_total)} icon="trending-up-outline" tone="success" />
                  <Stat testID="stat-collections" label="التحصيلات" value={money(s.collections_total)} icon="cash-outline" tone="info" />
                  <Stat testID="stat-debts" label="ديون العملاء" value={money(s.debts_total)} icon="alert-circle-outline" tone="warning" />
                  {isOwner && <Stat testID="stat-profit" label="إجمالي الربح" value={money(s.gross_profit)} icon="wallet-outline" tone="success" />}
                  {isOwner && <Stat testID="stat-stock-value" label="قيمة المخزون" value={money(s.stock_value)} icon="cube-outline" />}
                  {!isAgent && <Stat testID="stat-purchases" label="المشتريات" value={money(s.purchases_total)} icon="cart-outline" tone="info" />}
                  {!isAgent && <Stat testID="stat-returns" label="المرتجعات" value={money(s.returns_total)} icon="return-down-back-outline" tone="error" />}
                </View>

                {isAgent && <PendingDeliveries />}
                {isAgent && <MyRoute />}
                {isAgent && <AgentStock />}

                <Section title="آخر الفواتير">
                  <Card style={{ padding: 0, overflow: "hidden" }}>
                    {!s.recent_sales?.length ? (
                      <Empty icon="receipt-outline" text="لا توجد فواتير بعد" />
                    ) : (
                      s.recent_sales.map((x: any) => (
                        <Row key={x.id} icon="receipt-outline" avatarTone="accent" title={`${x.invoice_no} · ${x.customer_name}`} subtitle={x.distributor_name} right={<T v="label">{money(x.total)}</T>} />
                      ))
                    )}
                  </Card>
                </Section>

                {/* Agent-specific extras — kept in single-scroll flow */}
                {!useTabs && !isAgent && <AlertsCard />}
                {!useTabs && !isAgent && <StaleDebtorsCard />}
                {!useTabs && !isAgent && s.low_stock?.length > 0 && (
                  <Section title="تنبيهات نقص المخزون">
                    <Card style={{ padding: 0, overflow: "hidden" }}>
                      {s.low_stock.map((p: any) => (
                        <Row key={p.id} icon="warning-outline" avatarTone="warning" title={p.name} subtitle={`الحد الأدنى: ${p.min_stock}`} right={<Badge text={`${p.stock} ${p.unit}`} tone="warning" />} />
                      ))}
                    </Card>
                  </Section>
                )}
                {!useTabs && !isAgent && (
                  <ProLock testID="lock-targets" module="targets" feature="أهداف المبيعات ولوحة المتصدرين">
                    <SalesTargetsCard />
                    <Leaderboard />
                  </ProLock>
                )}
              </>
            )}

            {/* ─── ALERTS TAB ──────────────────────────────────────────────── */}
            {useTabs && tab === "alerts" && (
              <>
                {alertCount === 0 ? (
                  <Empty icon="checkmark-done-outline" text="لا توجد تنبيهات حالياً · كل شيء على ما يرام" />
                ) : null}
                <AlertsCard />
                <StaleDebtorsCard />
                {s.low_stock?.length > 0 && (
                  <Section title="تنبيهات نقص المخزون">
                    <Card style={{ padding: 0, overflow: "hidden" }}>
                      {s.low_stock.map((p: any) => (
                        <Row key={p.id} icon="warning-outline" avatarTone="warning" title={p.name} subtitle={`الحد الأدنى: ${p.min_stock}`} right={<Badge text={`${p.stock} ${p.unit}`} tone="warning" />} />
                      ))}
                    </Card>
                  </Section>
                )}
              </>
            )}

            {/* ─── PERFORMANCE TAB ─────────────────────────────────────────── */}
            {useTabs && tab === "performance" && (
              <>
                <ProLock testID="lock-targets" module="targets" feature="أهداف المبيعات ولوحة المتصدرين">
                  <SalesTargetsCard />
                  <Leaderboard />
                </ProLock>
              </>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}
