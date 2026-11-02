import { useState } from "react";
import { qtyLabel, piecesOf, pppOf, Unit, UnitToggle, unitName } from "@/src/components/UnitToggle";
import { View } from "react-native";

import { fmtDate, money } from "@/src/api";
import { useApi, useMutate } from "@/src/hooks";
import { offlineStockRequest } from "@/src/offlineActions";
import { spacing } from "@/src/theme";
import { Badge, Btn, Card, Empty, Field, IconBtn, Row, Section, Sheet, T, useToast } from "@/src/ui";

const LOW_MIN = 5;
const isLow = (i: any) => i.quantity <= Math.max(i.min_stock ?? 0, LOW_MIN);
const suggestQty = (i: any) => Math.max(10, (i.min_stock ?? 0) * 2);
const statusBadge: Record<string, { t: string; tone: "warning" | "success" | "error" }> = {
  PENDING: { t: "قيد الانتظار", tone: "warning" },
  FULFILLED: { t: "تم التسليم", tone: "success" },
  REJECTED: { t: "مرفوض", tone: "error" },
};

// Distributor: own stock with low-stock highlight and one-tap restock request.
export function AgentStock() {
  const toast = useToast();
  const inv = useApi<any[]>("/my/inventory");
  const reqs = useApi<any[]>("/stock-requests");
  const [sending, setSending] = useState(false);
  const items = inv.data ?? [];
  const low = items.filter(isLow);
  const pendingIds = new Set((reqs.data ?? []).filter((r) => r.status === "PENDING").flatMap((r) => r.items.map((x: any) => x.product_id)));
  const lowToRequest = low.filter((i) => !pendingIds.has(i.product_id));

  const request = async (list: any[]) => {
    setSending(true);
    try {
      await offlineStockRequest(list.map((i) => ({ product_id: i.product_id, product_name: i.product_name, quantity: suggestQty(i) })));
      toast("تم إرسال طلب التعبئة للمالك");
    } finally {
      setSending(false);
    }
  };
  // Single-item request with piece / package choice.
  const [one, setOne] = useState<{ item: any; qty: string; unit: Unit } | null>(null);
  const sendOne = async () => {
    if (!one || !(+one.qty > 0)) return toast("أدخل الكمية", "error");
    setSending(true);
    try {
      await offlineStockRequest([{ product_id: one.item.product_id, product_name: one.item.product_name, quantity: +one.qty, unit: one.unit, unit_label: unitName(one.item, one.unit), pieces: piecesOf(one.item, one.unit, +one.qty) }]);
      toast("تم إرسال طلب التعبئة للمالك");
      setOne(null);
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <Section title="مخزوني الحالي" action={low.length ? <Badge text={`${low.length} منخفض`} tone="warning" /> : undefined}>
        {lowToRequest.length > 0 && (
          <Btn testID="request-low-stock-button" icon="flash-outline" title={`طلب تعبئة ${lowToRequest.length} صنف منخفض`} loading={sending} onPress={() => request(lowToRequest)} />
        )}
        <Card style={{ padding: 0, overflow: "hidden" }}>
          {!items.length ? (
            <Empty icon="cube-outline" text="لا يوجد مخزون لديك. اطلب من المالك تسليمك بضاعة." />
          ) : (
            items.map((i) => (
              <Row
                key={i.product_id}
                testID={`my-stock-${i.product_id}`}
                icon={isLow(i) ? "warning-outline" : "cube-outline"}
                title={i.product_name}
                subtitle={`السعر: ${money(i.sale_price)}${pendingIds.has(i.product_id) ? " · طلب تعبئة قيد الانتظار" : ""}`}
                right={
                  <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                    <Badge text={money(i.quantity)} tone={isLow(i) ? "warning" : "brand"} />
                    {!pendingIds.has(i.product_id) && <IconBtn testID={`request-stock-${i.product_id}`} icon="add-circle-outline" onPress={() => setOne({ item: i, qty: String(suggestQty(i)), unit: "PIECE" })} />}
                  </View>
                }
              />
            ))
          )}
        </Card>
      </Section>
      {!!reqs.data?.length && (
        <Section title="طلبات التعبئة">
          <Card style={{ padding: 0, overflow: "hidden" }}>
            {reqs.data.slice(0, 5).map((r) => (
              <Row key={r.id} testID={`my-stock-request-${r.id}`} icon="file-tray-full-outline" title={r.items.map((x: any) => `${x.product_name} ×${qtyLabel(x)}`).join("، ")} subtitle={fmtDate(r.created_at)} right={<Badge text={r.pending ? "بانتظار المزامنة" : statusBadge[r.status].t} tone={r.pending ? "warning" : statusBadge[r.status].tone} />} />
            ))}
          </Card>
        </Section>
      )}
      <Sheet testID="stock-request-sheet" visible={!!one} onClose={() => setOne(null)} title={`طلب تعبئة · ${one?.item.product_name ?? ""}`} footer={<Btn testID="send-stock-request-button" title="إرسال الطلب" icon="send-outline" loading={sending} onPress={sendOne} />}>
        {one && (
          <>
            <UnitToggle testID="stock-request-unit" product={one.item} value={one.unit} onChange={(u) => setOne({ ...one, unit: u, qty: u === one.unit ? one.qty : String(u === "PACKAGE" ? Math.max(1, Math.ceil(+one.qty / pppOf(one.item))) : +one.qty * pppOf(one.item)) })} />
            <Field testID="stock-request-qty-input" label={`الكمية (${unitName(one.item, one.unit)})`} keyboardType="decimal-pad" value={one.qty} onChangeText={(v) => setOne({ ...one, qty: v })} />
            {one.unit === "PACKAGE" && +one.qty > 0 && <T v="caption" testID="stock-request-pieces-hint">= {money(piecesOf(one.item, "PACKAGE", +one.qty))} {unitName(one.item, "PIECE")}</T>}
          </>
        )}
      </Sheet>
    </>
  );
}

// Owner: pending restock requests with fulfill (creates a delivery) / reject.
export function OwnerStockRequests() {
  const reqs = useApi<any[]>("/stock-requests");
  const fulfill = useMutate<any>("POST", (b) => `/stock-requests/${b.id}/fulfill`, "تم تسليم الطلب للموزع");
  const reject = useMutate<any>("POST", (b) => `/stock-requests/${b.id}/reject`, "تم رفض الطلب");
  const pending = (reqs.data ?? []).filter((r) => r.status === "PENDING");
  if (!pending.length) return null;
  return (
    <Section title="طلبات تعبئة من الموزعين" action={<Badge text={String(pending.length)} tone="warning" />}>
      {pending.map((r) => (
        <Card key={r.id} testID={`stock-request-${r.id}`} style={{ gap: spacing.sm }}>
          <T v="label">{r.distributor_name}</T>
          <T v="caption">{fmtDate(r.created_at)}</T>
          {r.items.map((x: any) => (
            <T key={x.product_id}>• {x.product_name} × {qtyLabel(x)}</T>
          ))}
          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            <Btn testID={`fulfill-request-${r.id}`} small style={{ flex: 1 }} icon="car-outline" title="تسليم الآن" loading={fulfill.isPending} onPress={() => fulfill.mutate(r)} />
            <Btn testID={`reject-request-${r.id}`} small variant="ghost" icon="close" title="رفض" onPress={() => reject.mutate(r)} />
          </View>
        </Card>
      ))}
    </Section>
  );
}
