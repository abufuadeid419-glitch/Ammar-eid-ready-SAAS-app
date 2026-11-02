import { Image } from "expo-image";
import { useState } from "react";
import { Pressable, RefreshControl, ScrollView, View } from "react-native";

import { api, fmtDate, money } from "@/src/api";
import { AccountButton } from "@/src/components/AccountButton";
import { ReceiptViewer, REQ_STATUS, RequestDetails, StatusBadge } from "@/src/components/Billing";
import { PlanControls, fromPlanControls, toPlanControls } from "@/src/components/PlanControls";
import { useApi, useBottomChrome, useMutate } from "@/src/hooks";
import { MODULE_LABELS, tierLabel } from "@/src/pro";
import { queryClient } from "@/src/query-client";
import { pickReceiptImage } from "@/src/utils/receipt";
import { radius, spacing, useTheme } from "@/src/theme";
import { Badge, Btn, Card, Empty, Field, Header, HeaderIconBtn, Loading, Segments, Sheet, Stat, T, useToast } from "@/src/ui";

const PLAN_STATUS: Record<string, [string, "success" | "warning" | "brand" | "error"]> = {
  published: ["منشورة", "success"], changed: ["تعديلات غير منشورة", "warning"], draft: ["مسودة", "brand"], archived: ["مؤرشفة", "error"],
};
const blankPlan = { name: "", description: "", price: "", yearly_price: "", promo_price: "", promo_until: "", currency: "USD", days: "30", trial_days: "0", grace_days: "0", sort_order: "10", recommended: false, features: "", active: true, ...toPlanControls(null) };
const blankMethod = { name: "", kind: "bank", description: "", recipient: "", account: "", currency: "", instructions: "", require_reference: true, require_receipt: true, min_amount: "", max_amount: "", plan_ids: [] as string[], active: true, sort_order: "10" };
const numOrNull = (s: any) => (s === "" || s == null ? null : +s);

function Toggle({ testID, on, label, onPress }: { testID: string; on: boolean; label: string; onPress: () => void }) {
  return <Btn testID={testID} small variant={on ? "primary" : "secondary"} icon={on ? "checkbox" : "square-outline"} title={label} onPress={onPress} />;
}

export default function DevBilling() {
  const { colors } = useTheme();
  const toast = useToast();
  const bottom = useBottomChrome();
  const [tab, setTab] = useState<"requests" | "plans" | "methods" | "audit">("requests");
  const [filter, setFilter] = useState<string>("open");
  const reqs = useApi<any[]>("/upgrade-requests");
  const plans = useApi<any[]>("/plans");
  const methods = useApi<any[]>("/payment-methods");
  const stats = useApi<any>("/dev/billing/stats");
  const auditQ = useApi<any[]>("/dev/audit", tab === "audit");
  const settings = useApi<any>("/billing/settings");
  const [plan, setPlan] = useState<any>(null);
  const [method, setMethod] = useState<any>(null);
  const [sel, setSel] = useState<any>(null);
  const [note, setNote] = useState("");
  const [st, setSt] = useState<any>(null);
  const review = useMutate<any>("PATCH", (b) => `/dev/upgrade-requests/${b.id}`, "تم تحديث الطلب", () => { setSel(null); setNote(""); });
  const savePlanM = useMutate<any>("POST", (b) => (b.id ? `/dev/plans/${b.id}` : "/dev/plans"), "تم حفظ المسودة", (r) => setPlan((p: any) => (p ? { ...p, id: p.id ?? r.id } : p)));
  const updatePlanM = useMutate<any>("PUT", (b) => `/dev/plans/${b.id}`, "تم حفظ المسودة");
  const publish = useMutate<any>("POST", (b) => `/dev/plans/${b.id}/publish`, "تم النشر — ظهرت التغييرات للمالكين", () => setPlan(null));
  const archive = useMutate<any>("POST", (b) => `/dev/plans/${b.id}/archive`, "تم التحديث", () => setPlan(null));
  const restore = useMutate<any>("POST", (b) => `/dev/plans/${b.id}/restore`, "تمت استعادة الإصدار في المسودة", () => setPlan(null));
  const versions = useApi<any[]>(`/dev/plans/${plan?.id}/versions`, !!plan?.id);
  const saveMethod = useMutate<any>("POST", "/dev/payment-methods", "تم حفظ طريقة الدفع", (r) => setMethod((m: any) => (m ? { ...m, id: m.id ?? r.id } : m)));
  const archiveMethod = useMutate<any>("DELETE", (b) => `/dev/payment-methods/${b.id}`, "تمت أرشفة طريقة الدفع", () => setMethod(null));
  const saveSettings = useMutate<any>("PUT", "/dev/billing/settings", "تم حفظ الإعدادات");
  const [qrBusy, setQrBusy] = useState(false);

  const OPEN = ["PENDING", "UNDER_REVIEW", "NEEDS_INFO"];
  const rows = (reqs.data ?? []).filter((r) => (filter === "open" ? OPEN.includes(r.status) : filter === "all" ? true : r.status === filter));

  const planBody = (p: any) => ({
    name: p.name, description: p.description, tier: p.tier, price: +p.price || 0, yearly_price: numOrNull(p.yearly_price), promo_price: numOrNull(p.promo_price),
    promo_until: p.promo_until || null, currency: p.currency || "USD", days: +p.days || 30, trial_days: +p.trial_days || 0, grace_days: +p.grace_days || 0,
    sort_order: +p.sort_order || 10, recommended: !!p.recommended, active: p.active, ...fromPlanControls(p),
    features: String(p.features ?? "").split("\n").map((s: string) => s.trim()).filter(Boolean),
  });
  const saveDraft = () => {
    if (!plan.name.trim()) return toast("أدخل اسم الخطة", "error");
    if (plan.id) updatePlanM.mutate({ ...planBody(plan), id: plan.id });
    else savePlanM.mutate(planBody(plan));
  };
  const openPlan = (p: any) =>
    setPlan({
      ...p, ...toPlanControls(p), price: String(p.price ?? 0), yearly_price: p.yearly_price != null ? String(p.yearly_price) : "", promo_price: p.promo_price != null ? String(p.promo_price) : "",
      promo_until: p.promo_until ? String(p.promo_until).slice(0, 10) : "", days: String(p.days ?? 30), trial_days: String(p.trial_days ?? 0), grace_days: String(p.grace_days ?? 0),
      sort_order: String(p.sort_order ?? 10), description: p.description ?? "", features: (p.features ?? []).join("\n"), active: p.active !== false,
    });
  const methodBody = (m: any) => ({ ...m, min_amount: numOrNull(m.min_amount), max_amount: numOrNull(m.max_amount), sort_order: +m.sort_order || 10, qr_url: undefined, created_at: undefined, updated_at: undefined, archived: undefined, qr_type: undefined, org_ids: undefined });
  const uploadQr = async (remove = false) => {
    if (!method?.id) return toast("احفظ طريقة الدفع أولاً", "error");
    try {
      const f = remove ? null : await pickReceiptImage(2);
      if (!remove && !f) return;
      setQrBusy(true);
      await api(`/dev/payment-methods/${method.id}/qr`, { method: "POST", timeoutMs: 60000, body: { data: f?.base64 } });
      toast(remove ? "تمت إزالة رمز QR" : "تم رفع رمز QR");
      queryClient.invalidateQueries();
      setMethod({ ...method, qr_url: remove ? null : f!.uri });
    } catch (e: any) {
      toast(e.message, "error");
    } finally {
      setQrBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }} testID="dev-billing-screen">
      <Header
        title="الاشتراكات والمدفوعات"
        subtitle={`${stats.data?.open ?? 0} طلب مفتوح · ${stats.data?.expiring ?? 0} تنتهي خلال 7 أيام`}
        right={<>{tab === "plans" && <HeaderIconBtn testID="add-plan-button" icon="add" onPress={() => setPlan(blankPlan)} />}{tab === "methods" && <HeaderIconBtn testID="add-method-button" icon="add" onPress={() => setMethod(blankMethod)} />}<AccountButton /></>}
      />
      <Segments value={tab} onChange={setTab} options={[{ key: "requests", label: "طلبات الدفع" }, { key: "plans", label: "الخطط" }, { key: "methods", label: "طرق الدفع" }, { key: "audit", label: "السجل" }]} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: bottom + spacing.xl }} refreshControl={<RefreshControl refreshing={reqs.isRefetching} onRefresh={() => queryClient.invalidateQueries()} tintColor={colors.brandPrimary} />}>
        {tab === "requests" && (
          <>
            <View style={{ flexDirection: "row", gap: spacing.sm }} testID="billing-stats">
              <View style={{ flex: 1 }}><Stat testID="stat-open" label="مفتوحة" value={String(stats.data?.open ?? 0)} icon="time-outline" tone="warning" /></View>
              <View style={{ flex: 1 }}><Stat testID="stat-paid-orgs" label="Pro / VIP" value={`${stats.data?.tiers?.PRO ?? 0} / ${stats.data?.tiers?.VIP ?? 0}`} icon="diamond-outline" /></View>
            </View>
            {!!stats.data?.revenue && <T v="caption" testID="stat-revenue">الإيرادات المؤكدة: {Object.entries(stats.data.revenue).map(([c, v]) => `${money(v as number)} ${c}`).join(" · ") || "—"}</T>}
            <View style={{ marginHorizontal: -spacing.lg }}>
              <Segments value={filter} onChange={setFilter} options={[{ key: "open", label: "المفتوحة" }, { key: "all", label: "الكل" }, ...Object.entries(REQ_STATUS).map(([k, v]) => ({ key: k, label: v.t }))]} />
            </View>
            {reqs.isLoading ? <Loading /> : !rows.length ? <Empty icon="document-outline" text="لا توجد طلبات" /> : rows.map((r) => (
              <Card key={r.id} testID={`upgrade-request-${r.id}`} onPress={() => { setSel(r); setNote(""); }} style={{ gap: spacing.xs }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                  <T v="label" style={{ flex: 1 }}>{r.org_name}</T>
                  {r.amount_mismatch && <Badge text="المبلغ مختلف" tone="error" />}
                  <StatusBadge status={r.status} />
                </View>
                <T v="caption">{r.ref_code ?? r.id} · {r.plan_name} · {money(r.price)} {r.currency} · {fmtDate(r.created_at)}</T>
              </Card>
            ))}
          </>
        )}
        {tab === "plans" && (plans.isLoading ? <Loading /> : !plans.data?.length ? <Empty icon="pricetags-outline" text="لا توجد خطط. أنشئ Free و Pro و VIP." action={<Btn small testID="empty-add-plan-button" title="خطة جديدة" icon="add" onPress={() => setPlan(blankPlan)} />} /> : plans.data.map((p) => {
          const s = PLAN_STATUS[p.status ?? "published"] ?? PLAN_STATUS.published;
          return (
            <Card key={p.id} testID={`plan-row-${p.id}`} onPress={() => openPlan(p)} style={{ gap: spacing.xs }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                <T v="h2" style={{ flex: 1 }}>{p.name}</T>
                <Badge testID={`plan-tier-${p.id}`} text={p.tier === "FREE" ? "مجانية" : tierLabel(p.tier)} tone="pro" />
                <Badge testID={`plan-status-${p.id}`} text={s[0]} tone={s[1]} />
              </View>
              <T>{p.tier === "FREE" ? "مجاناً" : `${money(p.price)} ${p.currency} / ${p.days} يوم`}{p.yearly_price ? ` · سنوي ${money(p.yearly_price)}` : ""} · v{p.version ?? 1}</T>
              <T v="caption">{p.max_employees} موظف · {p.max_distributors ?? "∞"} موزع · {p.max_customers ?? "∞"} عميل · {(p.modules ?? []).length}/{Object.keys(MODULE_LABELS).length} ميزات · ترتيب {p.sort_order ?? 10}</T>
            </Card>
          );
        }))}
        {tab === "methods" && (
          <>
            {(methods.data ?? []).map((m) => (
              <Card key={m.id} testID={`method-row-${m.id}`} onPress={() => setMethod({ ...blankMethod, ...m, min_amount: m.min_amount ?? "", max_amount: m.max_amount ?? "", sort_order: String(m.sort_order ?? 10) })} style={{ flexDirection: "row", gap: spacing.md, alignItems: "center" }}>
                {m.qr_url ? <Image source={{ uri: m.qr_url }} style={{ width: 48, height: 48, borderRadius: radius.sm }} /> : null}
                <View style={{ flex: 1, gap: 2 }}>
                  <T v="label">{m.name}</T>
                  <T v="caption">{m.currency || "كل العملات"} · {m.plan_ids?.length ? `${m.plan_ids.length} خطط` : "كل الخطط"}</T>
                </View>
                <Badge text={m.active ? "مفعّلة" : "معطلة"} tone={m.active ? "success" : "warning"} />
              </Card>
            ))}
            {!methods.data?.length && <Empty icon="card-outline" text="أضف طريقة دفع (تحويل بنكي، محفظة...)" />}
            {settings.data && (
              <Card testID="billing-settings-card" style={{ gap: spacing.md }}>
                <T v="label">إعدادات التحقق</T>
                <Field testID="settings-max-mb-input" label="أقصى حجم للإيصال (MB، حتى 6)" keyboardType="number-pad" value={String(st?.max_receipt_mb ?? settings.data.max_receipt_mb)} onChangeText={(v) => setSt({ ...(st ?? settings.data), max_receipt_mb: v })} />
                <Field testID="settings-max-day-input" label="أقصى عدد طلبات يومياً لكل مؤسسة" keyboardType="number-pad" value={String(st?.max_requests_per_day ?? settings.data.max_requests_per_day)} onChangeText={(v) => setSt({ ...(st ?? settings.data), max_requests_per_day: v })} />
                <Field testID="settings-reminder-input" label="تذكير قبل الانتهاء (أيام)" keyboardType="number-pad" value={String(st?.reminder_days ?? settings.data.reminder_days)} onChangeText={(v) => setSt({ ...(st ?? settings.data), reminder_days: v })} />
                <Toggle testID="settings-allow-resubmit" on={(st ?? settings.data).allow_resubmit} label="السماح بإعادة الإرسال بعد الرفض" onPress={() => setSt({ ...(st ?? settings.data), allow_resubmit: !(st ?? settings.data).allow_resubmit })} />
                <Btn testID="save-billing-settings" title="حفظ الإعدادات" icon="checkmark" loading={saveSettings.isPending} onPress={() => { const s = st ?? settings.data; saveSettings.mutate({ max_receipt_mb: +s.max_receipt_mb, max_requests_per_day: +s.max_requests_per_day, reminder_days: +s.reminder_days, allow_resubmit: !!s.allow_resubmit }); }} />
              </Card>
            )}
          </>
        )}
        {tab === "audit" && (auditQ.isLoading ? <Loading /> : !auditQ.data?.length ? <Empty icon="list-outline" text="لا توجد سجلات" /> : auditQ.data.map((a, i) => (
          <Card key={i} testID={`audit-row-${i}`} style={{ gap: 2 }}>
            <T v="label">{a.action}</T>
            <T v="caption">{fmtDate(a.created_at)} · {a.actor_role ?? ""}{a.org_id ? ` · ${a.org_id}` : ""}{a.target ? ` · ${a.target}` : ""}</T>
            {!!a.note && <T v="caption">{a.note}</T>}
          </Card>
        )))}
      </ScrollView>

      <Sheet testID="review-sheet" visible={!!sel} onClose={() => setSel(null)} title={sel?.org_name ?? ""}
        footer={sel && (
          <View style={{ gap: spacing.sm }}>
            {["PENDING", "UNDER_REVIEW"].includes(sel.status) && <Btn testID="approve-request-button" title="تأكيد الاستلام وتفعيل الاشتراك" icon="checkmark" loading={review.isPending} onPress={() => review.mutate({ id: sel.id, action: "approve" })} />}
            <View style={{ flexDirection: "row", gap: spacing.sm }}>
              {sel.status === "PENDING" && <Btn testID="under-review-button" style={{ flex: 1 }} small variant="secondary" title="قيد المراجعة" onPress={() => review.mutate({ id: sel.id, action: "under_review" })} />}
              {["PENDING", "UNDER_REVIEW"].includes(sel.status) && <Btn testID="needs-info-button" style={{ flex: 1 }} small variant="secondary" title="طلب معلومات" onPress={() => review.mutate({ id: sel.id, action: "needs_info", note })} />}
              {["PENDING", "UNDER_REVIEW", "NEEDS_INFO"].includes(sel.status) && <Btn testID="reject-request-button" style={{ flex: 1 }} small variant="danger" title="رفض" onPress={() => review.mutate({ id: sel.id, action: "reject", note })} />}
              {sel.status === "APPROVED" && <Btn testID="refund-request-button" style={{ flex: 1 }} small variant="secondary" title="تسجيل استرداد" onPress={() => review.mutate({ id: sel.id, action: "refund", note })} />}
            </View>
          </View>
        )}
      >
        {sel && (
          <>
            <View style={{ flexDirection: "row", gap: spacing.sm, alignItems: "center" }}>
              <T v="caption" style={{ flex: 1 }}>{sel.owner_email}</T>
              <StatusBadge status={sel.status} />
            </View>
            <RequestDetails r={sel} />
            {sel.has_receipt ? <ReceiptViewer id={sel.id} testID="review-receipt-button" /> : <T v="caption" color="warning">لا يوجد إيصال مرفق</T>}
            {(sel.history ?? []).map((h: any, i: number) => <T key={i} v="caption">• {REQ_STATUS[h.status]?.t ?? h.status} · {h.by} · {fmtDate(h.at)}{h.note ? ` · ${h.note}` : ""}</T>)}
            <Field testID="review-note-input" label="السبب / الملاحظة (مطلوب للرفض وطلب المعلومات)" multiline value={note} onChangeText={setNote} />
          </>
        )}
      </Sheet>

      <Sheet testID="plan-form-sheet" visible={!!plan} onClose={() => setPlan(null)} title={plan?.id ? "تعديل خطة (مسودة)" : "خطة جديدة"}
        footer={plan && (
          <View style={{ gap: spacing.sm }}>
            <View style={{ flexDirection: "row", gap: spacing.sm }}>
              <Btn testID="save-plan-button" style={{ flex: 1 }} variant="secondary" title="حفظ كمسودة" icon="save-outline" loading={savePlanM.isPending || updatePlanM.isPending} onPress={saveDraft} />
              {plan.id && plan.status !== "archived" && <Btn testID="publish-plan-button" style={{ flex: 1 }} title="نشر" icon="cloud-upload-outline" loading={publish.isPending} onPress={() => publish.mutate({ id: plan.id })} />}
            </View>
            {plan.id && <Btn testID="archive-plan-button" small variant="ghost" title={plan.status === "archived" ? "إلغاء الأرشفة" : "أرشفة الخطة"} onPress={() => archive.mutate({ id: plan.id, restore: plan.status === "archived" })} />}
          </View>
        )}
      >
        {plan && (
          <>
            <T v="caption">التعديلات تُحفظ كمسودة ولا تظهر للمالكين حتى تضغط "نشر". الطلبات المرسلة سابقاً تحتفظ بأسعارها.</T>
            <Field testID="plan-name-input" label="اسم الخطة" value={plan.name} onChangeText={(v) => setPlan({ ...plan, name: v })} />
            <Field testID="plan-description-input" label="الوصف" multiline value={plan.description} onChangeText={(v) => setPlan({ ...plan, description: v })} />
            <PlanControls testPrefix="plan" tiers={["FREE", "PRO", "VIP"]} value={plan} onChange={(c) => setPlan({ ...plan, ...c })} />
            {plan.tier !== "FREE" && (
              <>
                <View style={{ flexDirection: "row", gap: spacing.md }}>
                  <View style={{ flex: 1 }}><Field testID="plan-price-input" label="السعر" keyboardType="decimal-pad" value={plan.price} onChangeText={(v) => setPlan({ ...plan, price: v })} /></View>
                  <View style={{ flex: 1 }}><Field testID="plan-days-input" label="المدة (أيام)" keyboardType="number-pad" value={plan.days} onChangeText={(v) => setPlan({ ...plan, days: v })} /></View>
                  <View style={{ flex: 1 }}><Field testID="plan-currency-input" label="العملة" value={plan.currency} onChangeText={(v) => setPlan({ ...plan, currency: v })} /></View>
                </View>
                <View style={{ flexDirection: "row", gap: spacing.md }}>
                  <View style={{ flex: 1 }}><Field testID="plan-yearly-price-input" label="السعر السنوي" placeholder="اختياري" keyboardType="decimal-pad" value={plan.yearly_price} onChangeText={(v) => setPlan({ ...plan, yearly_price: v })} /></View>
                  <View style={{ flex: 1 }}><Field testID="plan-promo-price-input" label="سعر العرض" placeholder="اختياري" keyboardType="decimal-pad" value={plan.promo_price} onChangeText={(v) => setPlan({ ...plan, promo_price: v })} /></View>
                </View>
                <Field testID="plan-promo-until-input" label="انتهاء العرض (YYYY-MM-DD)" placeholder="اختياري" value={plan.promo_until} onChangeText={(v) => setPlan({ ...plan, promo_until: v })} />
                <View style={{ flexDirection: "row", gap: spacing.md }}>
                  <View style={{ flex: 1 }}><Field testID="plan-grace-input" label="فترة السماح (أيام)" keyboardType="number-pad" value={plan.grace_days} onChangeText={(v) => setPlan({ ...plan, grace_days: v })} /></View>
                  <View style={{ flex: 1 }}><Field testID="plan-trial-input" label="أيام التجربة" keyboardType="number-pad" value={plan.trial_days} onChangeText={(v) => setPlan({ ...plan, trial_days: v })} /></View>
                </View>
              </>
            )}
            <Field testID="plan-order-input" label="ترتيب العرض" keyboardType="number-pad" value={plan.sort_order} onChangeText={(v) => setPlan({ ...plan, sort_order: v })} />
            <Field testID="plan-features-input" label="نقاط تسويقية إضافية (سطر لكل نقطة)" multiline value={plan.features} onChangeText={(v) => setPlan({ ...plan, features: v })} style={{ minHeight: 80 }} />
            <View style={{ flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" }}>
              <Toggle testID="toggle-plan-active-button" on={plan.active} label="ظاهرة للمالكين" onPress={() => setPlan({ ...plan, active: !plan.active })} />
              <Toggle testID="toggle-plan-recommended" on={!!plan.recommended} label="موصى بها" onPress={() => setPlan({ ...plan, recommended: !plan.recommended })} />
            </View>
            {!!versions.data?.length && (
              <View style={{ gap: spacing.xs }} testID="plan-versions">
                <T v="label">الإصدارات المنشورة</T>
                {versions.data.map((ver) => (
                  <Pressable key={ver.version} testID={`restore-version-${ver.version}`} onPress={() => restore.mutate({ id: plan.id, version: ver.version })} style={{ minHeight: 44, flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                    <T style={{ flex: 1 }}>v{ver.version} · {money(ver.snapshot?.price)} {ver.snapshot?.currency} · {fmtDate(ver.published_at)}</T>
                    <T v="caption" color="brandPrimary">استعادة للمسودة</T>
                  </Pressable>
                ))}
              </View>
            )}
          </>
        )}
      </Sheet>

      <Sheet testID="method-form-sheet" visible={!!method} onClose={() => setMethod(null)} title={method?.id ? "تعديل طريقة دفع" : "طريقة دفع جديدة"}
        footer={method && (
          <View style={{ gap: spacing.sm }}>
            <Btn testID="save-method-button" title="حفظ" icon="checkmark" loading={saveMethod.isPending} onPress={() => (method.name.trim() ? saveMethod.mutate(methodBody(method)) : toast("أدخل اسم الطريقة", "error"))} />
            {method.id && <Btn testID="archive-method-button" small variant="ghost" title="أرشفة طريقة الدفع" onPress={() => archiveMethod.mutate({ id: method.id })} />}
          </View>
        )}
      >
        {method && (
          <>
            <Field testID="method-name-input" label="الاسم (مثال: تحويل بنكي، شام كاش)" value={method.name} onChangeText={(v) => setMethod({ ...method, name: v })} />
            <Segments value={method.kind} onChange={(k) => setMethod({ ...method, kind: k })} options={[{ key: "bank", label: "بنك" }, { key: "wallet", label: "محفظة" }, { key: "cash", label: "نقدي" }, { key: "other", label: "أخرى" }]} />
            <Field testID="method-description-input" label="وصف قصير" value={method.description} onChangeText={(v) => setMethod({ ...method, description: v })} />
            <Field testID="method-recipient-input" label="اسم المستفيد" value={method.recipient} onChangeText={(v) => setMethod({ ...method, recipient: v })} />
            <Field testID="method-account-input" label="رقم الحساب / المحفظة / IBAN" value={method.account} onChangeText={(v) => setMethod({ ...method, account: v })} />
            <Field testID="method-currency-input" label="العملة (فارغ = كل العملات)" value={method.currency} onChangeText={(v) => setMethod({ ...method, currency: v })} />
            <Field testID="method-instructions-input" label="تعليمات الدفع" multiline value={method.instructions} onChangeText={(v) => setMethod({ ...method, instructions: v })} />
            <View style={{ flexDirection: "row", gap: spacing.md }}>
              <View style={{ flex: 1 }}><Field testID="method-min-input" label="أدنى مبلغ" keyboardType="decimal-pad" value={String(method.min_amount)} onChangeText={(v) => setMethod({ ...method, min_amount: v })} /></View>
              <View style={{ flex: 1 }}><Field testID="method-max-input" label="أعلى مبلغ" keyboardType="decimal-pad" value={String(method.max_amount)} onChangeText={(v) => setMethod({ ...method, max_amount: v })} /></View>
              <View style={{ flex: 1 }}><Field testID="method-order-input" label="الترتيب" keyboardType="number-pad" value={String(method.sort_order)} onChangeText={(v) => setMethod({ ...method, sort_order: v })} /></View>
            </View>
            <View style={{ flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" }}>
              <Toggle testID="method-active-toggle" on={method.active} label="مفعّلة" onPress={() => setMethod({ ...method, active: !method.active })} />
              <Toggle testID="method-ref-toggle" on={method.require_reference} label="مرجع إلزامي" onPress={() => setMethod({ ...method, require_reference: !method.require_reference })} />
              <Toggle testID="method-receipt-toggle" on={method.require_receipt} label="إيصال إلزامي" onPress={() => setMethod({ ...method, require_receipt: !method.require_receipt })} />
            </View>
            <T v="label">الخطط المسموحة (لا شيء = الكل)</T>
            <View style={{ flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" }}>
              {(plans.data ?? []).filter((p) => p.tier !== "FREE" && p.status !== "archived").map((p) => (
                <Toggle key={p.id} testID={`method-plan-${p.id}`} on={method.plan_ids.includes(p.id)} label={p.name} onPress={() => setMethod({ ...method, plan_ids: method.plan_ids.includes(p.id) ? method.plan_ids.filter((x: string) => x !== p.id) : [...method.plan_ids, p.id] })} />
              ))}
            </View>
            <T v="label">رمز QR للدفع</T>
            {method.qr_url ? <Image testID="method-qr-preview" source={{ uri: method.qr_url }} style={{ width: 160, height: 160, alignSelf: "center", borderRadius: radius.md }} contentFit="contain" /> : <T v="caption">لا يوجد رمز QR</T>}
            <View style={{ flexDirection: "row", gap: spacing.sm }}>
              <Btn testID="upload-qr-button" style={{ flex: 1 }} small variant="secondary" icon="qr-code-outline" title={method.qr_url ? "استبدال QR" : "رفع QR"} loading={qrBusy} onPress={() => uploadQr(false)} />
              {!!method.qr_url && <Btn testID="remove-qr-button" style={{ flex: 1 }} small variant="ghost" title="إزالة" onPress={() => uploadQr(true)} />}
            </View>
          </>
        )}
      </Sheet>
    </View>
  );
}
