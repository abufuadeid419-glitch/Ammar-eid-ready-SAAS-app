import { useRouter } from "expo-router";
import { Image } from "expo-image";
import * as Clipboard from "expo-clipboard";
import { useMemo, useState } from "react";
import { Linking, Pressable, RefreshControl, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, fmtDate, money } from "@/src/api";
import { queryClient } from "@/src/query-client";
import { useAuth } from "@/src/auth";
import { ReceiptViewer, RequestDetails, StatusBadge } from "@/src/components/Billing";
import { useApi, useMutate } from "@/src/hooks";
import { MODULE_LABELS, isPro, planLabel, tierLabel } from "@/src/pro";
import { PickedFile, pickReceiptImage, pickReceiptPdf } from "@/src/utils/receipt";
import { radius, spacing, useTheme } from "@/src/theme";
import { Badge, Btn, Card, Empty, Field, Header, Ionicons, Loading, Section, Segments, Sheet, T, useToast } from "@/src/ui";

const OPEN = ["PENDING", "UNDER_REVIEW", "NEEDS_INFO"];
const newKey = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
const promoOn = (p: any) => p.promo_price != null && (!p.promo_until || Date.parse(p.promo_until) > Date.now());
const priceFor = (p: any, billing: string) => (billing === "yearly" ? p.yearly_price : promoOn(p) ? p.promo_price : p.price);
const lim = (n: any, unit: string) => (n == null ? `${unit} بلا حد` : `حتى ${n} ${unit}`);

function Line({ ok = true, text }: { ok?: boolean; text: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: "row", gap: spacing.sm, alignItems: "center" }}>
      <Ionicons name={ok ? "checkmark-circle" : "close-circle-outline"} size={18} color={ok ? colors.success : colors.muted} />
      <T color={ok ? undefined : "muted"} style={{ flex: 1 }}>{text}</T>
    </View>
  );
}

function FilePicker({ file, setFile, maxMb, prefix }: { file: PickedFile | null; setFile: (f: PickedFile | null) => void; maxMb: number; prefix: string }) {
  const toast = useToast();
  const pick = async (fn: typeof pickReceiptImage) => {
    try {
      const f = await fn(maxMb);
      if (f) setFile(f);
    } catch (e: any) {
      toast(e.message, "error");
    }
  };
  return (
    <View style={{ gap: spacing.sm }}>
      <T v="label">إيصال التحويل (صورة أو PDF، حتى {maxMb}MB)</T>
      <View style={{ flexDirection: "row", gap: spacing.sm }}>
        <Btn testID={`${prefix}-pick-image`} style={{ flex: 1 }} small variant="secondary" icon="image-outline" title="صورة" onPress={() => pick(pickReceiptImage)} />
        <Btn testID={`${prefix}-pick-pdf`} style={{ flex: 1 }} small variant="secondary" icon="document-outline" title="PDF" onPress={() => pick(pickReceiptPdf)} />
      </View>
      {file && (
        <Card testID={`${prefix}-preview`} style={{ gap: spacing.sm }}>
          {file.type.startsWith("image/") ? (
            <Image source={{ uri: file.uri }} style={{ width: "100%", height: 180, borderRadius: radius.md }} contentFit="contain" />
          ) : (
            <View style={{ flexDirection: "row", gap: spacing.sm, alignItems: "center" }}>
              <Ionicons name="document-text-outline" size={28} />
              <T style={{ flex: 1 }} numberOfLines={1}>{file.name}</T>
            </View>
          )}
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <T v="caption" style={{ flex: 1 }}>{(file.size / 1024).toFixed(0)} KB</T>
            <Btn testID={`${prefix}-remove-file`} small variant="ghost" title="إزالة" onPress={() => setFile(null)} />
          </View>
        </Card>
      )}
    </View>
  );
}

export default function Subscription() {
  const router = useRouter();
  const { colors } = useTheme();
  const { user, refresh } = useAuth();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const plans = useApi<any[]>("/plans");
  const methods = useApi<any[]>("/payment-methods");
  const settings = useApi<any>("/billing/settings");
  const reqs = useApi<any[]>("/upgrade-requests");
  const pay = useApi<any>("/settings/payment");
  const maxMb = settings.data?.max_receipt_mb ?? 4;
  const org = user?.org;
  const [billing, setBilling] = useState<"monthly" | "yearly">("monthly");
  const [sel, setSel] = useState<any>(null);
  const [form, setForm] = useState<any>(null);
  const [file, setFile] = useState<PickedFile | null>(null);
  const [busy, setBusy] = useState(false);
  const [resub, setResub] = useState<any>(null);
  const cancel = useMutate<any>("POST", (b) => `/upgrade-requests/${b.id}/cancel`, "تم إلغاء الطلب");
  const hasYearly = plans.data?.some((p) => p.yearly_price);
  const openReq = reqs.data?.find((r) => OPEN.includes(r.status));
  const okMethods = useMemo(
    () => (methods.data ?? []).filter((m) => (!m.plan_ids?.length || m.plan_ids.includes(sel?.id)) && (!m.currency || m.currency === sel?.currency)),
    [methods.data, sel],
  );
  const method = okMethods.find((m) => m.id === form?.method_id);

  const choose = (p: any) => {
    setSel(p);
    setFile(null);
    // One idempotency key per checkout: retries / double taps can't create two requests.
    setForm({ method_id: null, amount: String(priceFor(p, billing) ?? ""), ref: "", notes: "", key: newKey() });
  };
  const refetchAll = () => {
    queryClient.invalidateQueries();
    refresh();
  };
  const submit = async () => {
    if (busy) return;
    if (!method) return toast("اختر طريقة الدفع", "error");
    if (method.require_reference !== false && !form.ref.trim()) return toast("أدخل رقم/مرجع التحويل", "error");
    if (method.require_receipt !== false && !file) return toast("أرفق إيصال التحويل", "error");
    setBusy(true);
    try {
      const r = await api<any>("/upgrade-requests", {
        method: "POST",
        timeoutMs: 90000,
        body: { plan_id: sel.id, billing, method_id: method.id, amount: +form.amount || 0, payment_ref: form.ref, notes: form.notes, idem_key: form.key, receipt: file?.base64 },
      });
      toast(`تم إرسال الطلب ${r.ref_code ?? ""} — بانتظار تحقق المطور`);
      setSel(null);
      refetchAll();
    } catch (e: any) {
      toast(e.message, "error");
    } finally {
      setBusy(false);
    }
  };
  const resubmit = async () => {
    if (!file || busy) return toast("أرفق إيصالاً جديداً", "error");
    setBusy(true);
    try {
      await api(`/upgrade-requests/${resub.id}/receipt`, { method: "POST", timeoutMs: 90000, body: { receipt: file.base64, payment_ref: resub.ref, amount: +resub.amount || undefined } });
      toast("تم إرسال الإيصال الجديد للمراجعة");
      setResub(null);
      refetchAll();
    } catch (e: any) {
      toast(e.message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }} testID="upgrade-screen">
      <Header title="الخطط والاشتراك" subtitle={org?.name} onBack={() => (router.canGoBack() ? router.back() : router.replace("/"))} />
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.xl, paddingBottom: insets.bottom + spacing.xl }}
        refreshControl={<RefreshControl refreshing={plans.isRefetching} onRefresh={refetchAll} tintColor={colors.brandPrimary} />}
      >
        <Card testID="current-plan-card" style={{ gap: spacing.xs, backgroundColor: colors.brandTertiary, borderColor: colors.brandSecondary }}>
          <T v="caption">اشتراكك الحالي</T>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
            <T v="h2" style={{ flex: 1 }}>{org?.plan === "LICENSE" ? org?.plan_name ?? tierLabel(org?.plan_tier) : planLabel(org)}</T>
            <Badge testID="current-plan-status" text={isPro(org) ? "فعّال" : org?.status === "SUSPENDED" ? "موقوف" : "الخطة المجانية"} tone={isPro(org) ? "success" : "warning"} />
          </View>
          {isPro(org) && <T v="caption">ينتهي {fmtDate(org.expires_at)}{org.grace_until ? ` · فترة سماح حتى ${fmtDate(org.grace_until)}` : ""}</T>}
          {isPro(org) && <T v="caption">{lim(org.max_employees, "موظف")} · {lim(org.max_distributors, "موزع")} · {lim(org.max_customers, "عميل")}</T>}
        </Card>

        <Section title="الخطط المتاحة">
          {hasYearly && (
            <View style={{ marginHorizontal: -spacing.lg }}>
              <Segments value={billing} onChange={setBilling} options={[{ key: "monthly", label: "شهري" }, { key: "yearly", label: "سنوي" }]} />
            </View>
          )}
          {plans.isLoading ? (
            <Loading />
          ) : !plans.data?.length ? (
            <Empty icon="pricetags-outline" text="لا توجد خطط منشورة حالياً" />
          ) : (
            plans.data.map((p) => {
              const price = priceFor(p, billing);
              const free = p.tier === "FREE";
              return (
                <Card key={p.id} testID={`plan-card-${p.id}`} style={{ gap: spacing.sm, ...(p.recommended ? { borderColor: colors.brandPrimary, borderWidth: 2 } : {}) }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                    <T v="h2" style={{ flex: 1 }}>{p.name}</T>
                    {p.recommended && <Badge testID={`plan-recommended-${p.id}`} text="موصى بها" tone="success" />}
                    <Badge testID={`plan-card-tier-${p.id}`} text={free ? "مجانية" : tierLabel(p.tier)} tone="pro" />
                  </View>
                  {!!p.description && <T v="caption">{p.description}</T>}
                  <View style={{ flexDirection: "row", alignItems: "baseline", gap: spacing.sm }}>
                    <T v="title" color="brandPrimary" testID={`plan-price-${p.id}`}>{free ? "مجاناً" : price == null ? "غير متاح" : `${money(price)} ${p.currency}`}</T>
                    {!free && price != null && <T v="caption">/ {billing === "yearly" ? "سنة" : `${p.days} يوم`}</T>}
                    {!free && billing === "monthly" && promoOn(p) && <T v="caption" style={{ textDecorationLine: "line-through" }}>{money(p.price)}</T>}
                  </View>
                  <Line text={lim(p.max_employees, "موظف")} />
                  <Line text={lim(p.max_distributors, "موزع")} />
                  <Line text={lim(p.max_customers, "عميل")} />
                  {Object.entries(MODULE_LABELS).map(([k, label]) => (
                    <Line key={k} ok={!free && (p.modules ?? []).includes(k)} text={label} />
                  ))}
                  {p.features?.map((f: string, i: number) => <Line key={i} text={f} />)}
                  {free ? (
                    <T v="caption">تُطبّق تلقائياً عند عدم وجود اشتراك مدفوع فعّال.</T>
                  ) : (
                    <Btn testID={`choose-plan-${p.id}`} title={org?.plan_id === p.id && isPro(org) ? "تجديد هذه الخطة" : "اختيار هذه الخطة"} disabled={!!openReq || price == null} onPress={() => choose(p)} />
                  )}
                </Card>
              );
            })
          )}
          {!!openReq && <T v="caption" color="warning" style={{ textAlign: "center" }} testID="open-request-note">لديك طلب دفع مفتوح ({openReq.ref_code}) — انتظر المراجعة أو ألغِه</T>}
        </Section>

        <Section title="طلبات الدفع">
          {!reqs.data?.length ? (
            <Empty icon="document-outline" text="لا توجد طلبات" />
          ) : (
            reqs.data.map((r) => (
              <Card key={r.id} testID={`my-request-${r.id}`} style={{ gap: spacing.sm }}>
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <T v="label" style={{ flex: 1 }}>{r.plan_name}</T>
                  <StatusBadge testID={`my-request-status-${r.id}`} status={r.status} />
                </View>
                <RequestDetails r={r} />
                {r.status === "PENDING" && <T v="caption" color="warning">رفع الإيصال لا يعني تأكيد الدفع — يتم التفعيل بعد تحقق المطور فقط.</T>}
                {r.has_receipt && <ReceiptViewer id={r.id} testID={`my-request-receipt-${r.id}`} />}
                <View style={{ flexDirection: "row", gap: spacing.sm }}>
                  {(["NEEDS_INFO", "PENDING"].includes(r.status) || (r.status === "REJECTED" && settings.data?.allow_resubmit)) && (
                    <Btn testID={`resubmit-request-${r.id}`} style={{ flex: 1 }} small variant="secondary" icon="refresh" title="إيصال جديد" onPress={() => { setFile(null); setResub({ id: r.id, ref: r.payment_ref ?? "", amount: String(r.amount ?? "") }); }} />
                  )}
                  {OPEN.includes(r.status) && (
                    <Btn testID={`cancel-request-${r.id}`} style={{ flex: 1 }} small variant="ghost" title="إلغاء الطلب" onPress={() => cancel.mutate({ id: r.id })} />
                  )}
                </View>
              </Card>
            ))
          )}
        </Section>
        {!!pay.data?.whatsapp && (
          <Btn testID="contact-whatsapp-button" variant="secondary" icon="logo-whatsapp" title="تواصل مع الدعم" onPress={() => Linking.openURL(`https://wa.me/${pay.data.whatsapp.replace(/[^\d]/g, "")}`)} />
        )}
      </ScrollView>

      <Sheet
        testID="upgrade-request-sheet"
        visible={!!sel}
        onClose={() => setSel(null)}
        title={`الدفع · ${sel?.name ?? ""}`}
        footer={<Btn testID="submit-upgrade-button" title="إرسال طلب الدفع" icon="send-outline" loading={busy} disabled={busy} onPress={submit} />}
      >
        {sel && form && (
          <>
            <Card style={{ gap: spacing.xs }}>
              <T v="label" testID="upgrade-amount">المبلغ المطلوب: {money(priceFor(sel, billing))} {sel.currency} · {billing === "yearly" ? "سنوي" : `${sel.days} يوم`}</T>
              {!!pay.data?.instructions && <T v="caption">{pay.data.instructions}</T>}
            </Card>
            <T v="label">طريقة الدفع</T>
            {!okMethods.length && <Empty icon="card-outline" text="لا توجد طرق دفع متاحة لهذه الخطة حالياً" />}
            {okMethods.map((m) => {
              const on = form.method_id === m.id;
              return (
                <Pressable key={m.id} testID={`method-option-${m.id}`} onPress={() => setForm({ ...form, method_id: m.id })} style={{ minHeight: 52, flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderRadius: radius.md, borderWidth: 1.5, borderColor: on ? colors.brandPrimary : colors.border, backgroundColor: on ? colors.brandTertiary : colors.surfaceSecondary }}>
                  <Ionicons name={on ? "radio-button-on" : "radio-button-off"} size={20} color={on ? colors.brandPrimary : colors.muted} />
                  <View style={{ flex: 1 }}>
                    <T v="label">{m.name}</T>
                    {!!m.description && <T v="caption">{m.description}</T>}
                  </View>
                </Pressable>
              );
            })}
            {method && (
              <Card testID="method-details" style={{ gap: spacing.sm }}>
                {!!method.qr_url && <Image testID="method-qr-image" source={{ uri: method.qr_url }} style={{ width: 200, height: 200, alignSelf: "center", borderRadius: radius.md }} contentFit="contain" />}
                {!!method.recipient && <T>المستفيد: {method.recipient}</T>}
                {!!method.account && (
                  <Pressable testID="copy-account-button" onPress={async () => { await Clipboard.setStringAsync(method.account); toast("تم النسخ"); }} style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                    <T v="label" selectable style={{ flex: 1 }}>{method.account}</T>
                    <Ionicons name="copy-outline" size={18} color={colors.brandPrimary} />
                  </Pressable>
                )}
                {!!method.instructions && <T v="caption">{method.instructions}</T>}
                {(method.min_amount != null || method.max_amount != null) && <T v="caption">الحدود: {method.min_amount ?? 0} – {method.max_amount ?? "∞"}</T>}
              </Card>
            )}
            <Field testID="payment-amount-input" label={`المبلغ المحوَّل (${sel.currency})`} keyboardType="decimal-pad" value={form.amount} onChangeText={(v) => setForm({ ...form, amount: v.replace(/[^\d.]/g, "") })} />
            <Field testID="payment-ref-input" label={`رقم / مرجع التحويل${method?.require_reference === false ? " (اختياري)" : ""}`} value={form.ref} onChangeText={(v) => setForm({ ...form, ref: v })} />
            <Field testID="upgrade-notes-input" label="ملاحظة (اختياري)" value={form.notes} onChangeText={(v) => setForm({ ...form, notes: v })} />
            <FilePicker file={file} setFile={setFile} maxMb={maxMb} prefix="receipt" />
          </>
        )}
      </Sheet>

      <Sheet
        testID="resubmit-sheet"
        visible={!!resub}
        onClose={() => setResub(null)}
        title="إرسال إيصال جديد"
        footer={<Btn testID="submit-resubmit-button" title="إرسال للمراجعة" icon="send-outline" loading={busy} disabled={busy} onPress={resubmit} />}
      >
        {resub && (
          <>
            <Field testID="resubmit-ref-input" label="مرجع التحويل" value={resub.ref} onChangeText={(v) => setResub({ ...resub, ref: v })} />
            <Field testID="resubmit-amount-input" label="المبلغ المحوَّل" keyboardType="decimal-pad" value={resub.amount} onChangeText={(v) => setResub({ ...resub, amount: v.replace(/[^\d.]/g, "") })} />
            <FilePicker file={file} setFile={setFile} maxMb={maxMb} prefix="resubmit" />
          </>
        )}
      </Sheet>
    </View>
  );
}
