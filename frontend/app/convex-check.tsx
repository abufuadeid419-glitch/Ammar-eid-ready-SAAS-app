import { useMutation, useQuery } from "convex/react";
import { useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, View } from "react-native";

import { api } from "@/convex/_generated/api";
import { money } from "@/src/api";
import { useAuth } from "@/src/auth";
import { spacing, useTheme } from "@/src/theme";
import { Btn, Card, Empty, Field, Header, Loading, Row, Stat, T, useToast } from "@/src/ui";

// Live Convex dashboard. Reads the owner overview + agent leaderboard and the
// products list straight from the Convex deployment via Convex React hooks
// (useQuery) and writes via useMutation. It first mirrors the current (already
// authenticated) session into Convex so the same bearer token authenticates
// Convex functions — see convex/auth.ts. Standalone so it never touches the
// existing FastAPI-backed flows.
export default function ConvexCheck() {
  const { colors } = useTheme();
  const { token, user } = useAuth();
  const toast = useToast();
  const router = useRouter();

  const ready = true;

  const arg = ready && token ? { token } : "skip";
  const overview = useQuery(api.stats.overview, arg);
  const board = useQuery(api.stats.leaderboard, arg);
  const products = useQuery(api.products.list, arg);
  const tracking = useQuery(api.tracking.agents, arg);
  const distInventory = useQuery(api.deliveries.distributorsInventory, arg);
  const deliveries = useQuery(api.deliveries.list, arg);
  const employees = useQuery(api.employees.list, arg);
  const routes = useQuery(api.routes.list, arg);
  const vouchers = useQuery(api.vouchers.list, arg);
  const purchases = useQuery(api.purchases.list, arg);
  const create = useMutation(api.products.create);
  const remove = useMutation(api.products.remove);

  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(false);

  const add = async () => {
    if (!token) return toast("سجّل الدخول أولاً", "error");
    if (!name.trim()) return toast("أدخل اسم المنتج", "error");
    setBusy(true);
    try {
      await create({ token, name: name.trim(), sale_price: +price || 0 });
      setName("");
      setPrice("");
      toast("تمت الإضافة ✓ — ستُحدَّث البطاقات فوراً");
    } catch (e: any) {
      toast(e.message ?? "فشل", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }} testID="convex-check-screen">
      <Header title="لوحة البيانات الحيّة" subtitle="الأرقام تُحدَّث لحظياً" />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}>
        {!ready || overview === undefined ? (
          <Loading />
        ) : (
          <>
            <T v="h2">نظرة عامة</T>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.md }}>
              <Stat testID="cc-stat-sales" icon="cash-outline" label="إجمالي المبيعات" value={money(overview.sales_total)} tone="brand" />
              <Stat testID="cc-stat-today" icon="today-outline" label="مبيعات اليوم" value={money(overview.today_sales)} tone="info" />
              <Stat icon="wallet-outline" label="التحصيلات" value={money(overview.collections_total)} tone="success" />
              <Stat icon="alert-circle-outline" label="الديون" value={money(overview.debts_total)} tone="error" />
              {overview.gross_profit != null && (
                <Stat icon="trending-up-outline" label="الربح الإجمالي" value={money(overview.gross_profit)} tone="success" />
              )}
              <Stat icon="layers-outline" label="قيمة المخزون" value={money(overview.stock_value)} tone="info" />
              <Stat testID="cc-stat-products" icon="cube-outline" label="المنتجات" value={String(overview.products)} tone="brand" />
              <Stat icon="people-outline" label="العملاء" value={String(overview.customers)} tone="info" />
            </View>

            <T v="h2">ترتيب الموزعين · {board?.month ?? "—"}</T>
            {board === undefined ? (
              <Loading />
            ) : board.agents.length === 0 ? (
              <Empty icon="trophy-outline" text="لا يوجد موزعون بعد" />
            ) : (
              <Card style={{ padding: 0, overflow: "hidden" }}>
                {board.agents.map((a: any) => (
                  <Row
                    key={a.user_id}
                    icon="person-outline"
                    title={`#${a.rank} · ${a.name || a.email}`}
                    subtitle={`${a.sales_count} فاتورة · تحصيل ${money(a.collections_total)}`}
                    right={<T v="label">{money(a.sales_total)}</T>}
                  />
                ))}
              </Card>
            )}

            <T v="h2">الخريطة الحية للمندوبين</T>
            {tracking === undefined ? (
              <Loading />
            ) : tracking.length === 0 ? (
              <Empty icon="map-outline" text="لا يوجد مندوبون بعد" />
            ) : (
              <Card style={{ padding: 0, overflow: "hidden" }}>
                {tracking.map((a: any) => (
                  <Row
                    key={a.user_id}
                    icon="navigate-outline"
                    title={a.name || a.email}
                    subtitle={
                      a.last_location
                        ? `آخر موقع: ${Number(a.last_location.lat).toFixed(4)}, ${Number(a.last_location.lng).toFixed(4)}`
                        : "لا يوجد موقع بعد"
                    }
                    right={<T v="label">{a.today_visits.length} زيارة</T>}
                  />
                ))}
              </Card>
            )}
            <T v="caption" color="muted">خريطة المسار الكاملة تظهر داخل تطبيق الجوال (نسخة مبنية).</T>

            <T v="h2">مخزون الموزعين</T>
            {distInventory === undefined ? (
              <Loading />
            ) : distInventory.length === 0 ? (
              <Empty icon="cube-outline" text="لا يوجد مخزون لدى الموزعين" />
            ) : (
              <Card style={{ padding: 0, overflow: "hidden" }}>
                {distInventory.map((r: any, i: number) => (
                  <Row key={i} icon="cube-outline" title={r.product_name} subtitle="لدى موزع" right={<T v="label">{r.quantity}</T>} />
                ))}
              </Card>
            )}

            <T v="h2">آخر الشحنات</T>
            {deliveries === undefined ? (
              <Loading />
            ) : deliveries.length === 0 ? (
              <Empty icon="cube-outline" text="لا توجد شحنات" />
            ) : (
              <Card style={{ padding: 0, overflow: "hidden" }}>
                {deliveries.slice(0, 8).map((d: any) => (
                  <Row key={d.id} icon="cube-outline" title={d.distributor_name || "—"} subtitle={`${(d.items || []).length} صنف`} right={<T v="label">{d.status}</T>} />
                ))}
              </Card>
            )}

            <T v="h2">الموظفون</T>
            {employees === undefined ? (
              <Loading />
            ) : (
              <Card style={{ padding: 0, overflow: "hidden" }}>
                <Row icon="people-outline" title="عدد الموظفين" right={<T v="label">{employees.employees.length}</T>} />
                <Row icon="mail-outline" title="دعوات معلّقة" right={<T v="label">{employees.invitations.length}</T>} />
                {employees.invitations.map((i: any) => (
                  <Row key={i.id} icon="key-outline" title={i.name || "—"} subtitle={i.employee_type} right={<T v="label">{i.code}</T>} />
                ))}
              </Card>
            )}

            <T v="h2">خطوط السير · حيّ</T>
            {routes === undefined ? (
              <Loading />
            ) : routes.length === 0 ? (
              <Empty icon="map-outline" text="لا توجد خطوط سير" />
            ) : (
              <Card style={{ padding: 0, overflow: "hidden" }}>
                {routes.slice(0, 8).map((r: any) => (
                  <Row key={r.id} icon="navigate-outline" title={r.distributor_name || "موزع"} subtitle={`${r.date} · ${(r.stops || []).length} محطة`} right={<T v="label">{(r.stops || []).filter((s: any) => s.status === "VISITED").length} زيارة</T>} />
                ))}
              </Card>
            )}

            <T v="h2">سندات الصرف · حيّ</T>
            {vouchers === undefined ? (
              <Loading />
            ) : vouchers.length === 0 ? (
              <Empty icon="cash-outline" text="لا توجد سندات صرف" />
            ) : (
              <Card style={{ padding: 0, overflow: "hidden" }}>
                {vouchers.slice(0, 8).map((p: any) => (
                  <Row key={p.id} icon="cash-outline" title={p.customer_name || "عميل"} subtitle={`${p.voucher_no} · ${p.distributor_name || ""}`} right={<T v="label">{money(p.amount)}</T>} />
                ))}
              </Card>
            )}

            <T v="h2">المشتريات · حيّ</T>
            {purchases === undefined ? (
              <Loading />
            ) : purchases.length === 0 ? (
              <Empty icon="bag-handle-outline" text="لا توجد مشتريات" />
            ) : (
              <Card style={{ padding: 0, overflow: "hidden" }}>
                {purchases.slice(0, 8).map((p: any) => (
                  <Row key={p.id} icon="bag-handle-outline" title={p.product_name || "منتج"} subtitle={`${p.supplier || "مورّد"} · ${p.quantity} وحدة`} right={<T v="label">{money(p.total)}</T>} />
                ))}
              </Card>
            )}

            <T v="h2">إضافة منتج</T>
            <Card style={{ gap: spacing.md, borderColor: colors.brandPrimary }}>
              <Field testID="cc-name-input" label="اسم المنتج" value={name} onChangeText={setName} />
              <Field testID="cc-price-input" label="سعر البيع" keyboardType="decimal-pad" value={price} onChangeText={setPrice} />
              <Btn testID="cc-add-button" title="إضافة" icon="add" loading={busy} onPress={add} />
            </Card>

            <T v="h2">المنتجات · حيّ</T>
            {products === undefined ? (
              <Loading />
            ) : products.length === 0 ? (
              <Empty icon="cube-outline" text="لا توجد منتجات بعد" />
            ) : (
              <Card style={{ padding: 0, overflow: "hidden" }}>
                {products.map((p: any) => (
                  <Row
                    key={p.id}
                    testID={`cc-row-${p.id}`}
                    icon="cube-outline"
                    title={p.name}
                    subtitle={p.category || "—"}
                    right={<T v="label">{money(p.sale_price)}</T>}
                    onPress={() => token && remove({ token, id: p.id }).catch((e: any) => toast(e.message, "error"))}
                  />
                ))}
              </Card>
            )}
            <T v="caption" color="muted">اضغط على أي منتج لحذفه. البطاقات أعلاه تتحدّث تلقائياً.</T>
          </>
        )}
        <Btn testID="cc-back-button" variant="ghost" title="رجوع" onPress={() => router.back()} />
      </ScrollView>
    </View>
  );
}
