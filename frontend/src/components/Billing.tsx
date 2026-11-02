import { Image } from "expo-image";
import { useState } from "react";
import { View } from "react-native";

import { api, fmtDate, money } from "@/src/api";
import { useApi, useMutate } from "@/src/hooks";
import { openPdfDataUri } from "@/src/utils/receipt";
import { radius, spacing } from "@/src/theme";
import { Badge, Btn, Card, Field, T, useToast } from "@/src/ui";

// Shared payment-request status labels (owner + developer screens).
export const REQ_STATUS: Record<string, { t: string; tone: "warning" | "success" | "error" | "brand" | "accent" }> = {
  PENDING: { t: "بانتظار التحقق", tone: "warning" },
  UNDER_REVIEW: { t: "قيد المراجعة", tone: "brand" },
  NEEDS_INFO: { t: "مطلوب معلومات", tone: "accent" },
  APPROVED: { t: "تمت الموافقة", tone: "success" },
  REJECTED: { t: "مرفوض", tone: "error" },
  CANCELLED: { t: "ملغى", tone: "error" },
  REFUNDED: { t: "مسترد", tone: "accent" },
};

export function StatusBadge({ status, testID }: { status: string; testID?: string }) {
  const s = REQ_STATUS[status] ?? { t: status, tone: "brand" as const };
  return <Badge testID={testID} text={s.t} tone={s.tone} />;
}

// Request summary lines (amounts are the values frozen at submission time).
export function RequestDetails({ r }: { r: any }) {
  return (
    <View style={{ gap: 2 }}>
      <T v="caption" selectable>رقم الطلب: {r.ref_code ?? r.id}</T>
      <T>{r.plan_name} · السعر {money(r.price)} {r.currency} · {r.days} يوم</T>
      <T v="caption">المحوَّل: {money(r.amount ?? r.price)} {r.currency} عبر {r.method_name ?? "—"}{r.amount_mismatch ? " · ⚠ المبلغ لا يطابق السعر" : ""}</T>
      {!!r.payment_ref && <T v="caption" selectable>مرجع التحويل: {r.payment_ref}</T>}
      {!!r.notes && <T v="caption">ملاحظة: {r.notes}</T>}
      <T v="caption">أُرسل: {fmtDate(r.created_at)}{r.reviewed_at ? ` · روجع: ${fmtDate(r.reviewed_at)}` : ""}</T>
      {!!r.review_note && <T v="caption" color="error">ملاحظة المراجعة: {r.review_note}</T>}
    </View>
  );
}

// Developer org sheet: usage vs limits, open requests, and manual plan assignment.
export function OrgSubscription({ orgId }: { orgId: string }) {
  const d = useApi<any>(`/dev/orgs/${orgId}`);
  const plans = useApi<any[]>("/plans");
  const [planId, setPlanId] = useState<string | null>(null);
  const [days, setDays] = useState("30");
  const assign = useMutate<any>("POST", `/dev/orgs/${orgId}/assign-plan`, "تم تعيين الخطة");
  if (!d.data) return null;
  const u = d.data.usage, l = d.data.limits;
  const live = (plans.data ?? []).filter((p) => p.live);
  return (
    <Card testID="org-subscription-card" style={{ gap: spacing.sm }}>
      <T v="label">الاستخدام مقابل الحدود</T>
      <T testID="org-usage-text">موظفون {u.employees}/{l.employees ?? "∞"} · موزعون {u.distributors}/{l.distributors ?? "∞"} · عملاء {u.customers}/{l.customers ?? "∞"}</T>
      <T v="caption">طلبات دفع مفتوحة: {d.data.pending}</T>
      <T v="label">تعيين خطة يدوياً</T>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
        {live.map((p) => (
          <Btn key={p.id} testID={`assign-plan-${p.id}`} small variant={planId === p.id ? "primary" : "secondary"} title={p.live.name} onPress={() => setPlanId(p.id)} />
        ))}
      </View>
      <Field testID="assign-days-input" label="المدة (أيام)" keyboardType="number-pad" value={days} onChangeText={(v) => setDays(v.replace(/\D/g, ""))} />
      <Btn testID="assign-plan-submit" small title="تعيين" icon="swap-horizontal" disabled={!planId || !+days} loading={assign.isPending} onPress={() => assign.mutate({ plan_id: planId, days: +days })} />
      {d.data.requests.slice(0, 3).map((r: any) => (
        <T key={r.id} v="caption">• {r.ref_code ?? r.id} · {r.plan_name} · {REQ_STATUS[r.status]?.t ?? r.status} · {fmtDate(r.created_at)}</T>
      ))}
    </Card>
  );
}

// Fetches the receipt through the authenticated endpoint (never a public URL).
export function ReceiptViewer({ id, testID }: { id: string; testID: string }) {
  const toast = useToast();
  const [img, setImg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const open = async () => {
    setLoading(true);
    try {
      const r = await api<{ data_uri: string | null; type?: string }>(`/upgrade-requests/${id}/receipt`);
      if (!r.data_uri) toast("لا يوجد إيصال مرفق", "error");
      else if (r.type === "application/pdf") await openPdfDataUri(r.data_uri);
      else setImg(r.data_uri);
    } catch (e: any) {
      toast(e.message, "error");
    } finally {
      setLoading(false);
    }
  };
  return (
    <View style={{ gap: spacing.sm }}>
      {img ? (
        <Image testID={`${testID}-image`} source={{ uri: img }} style={{ width: "100%", height: 260, borderRadius: radius.md }} contentFit="contain" />
      ) : (
        <Btn testID={testID} small variant="secondary" icon="document-attach-outline" title="عرض الإيصال" loading={loading} onPress={open} />
      )}
    </View>
  );
}
