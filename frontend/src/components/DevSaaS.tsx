// Developer-only SaaS tools: plan extras (dynamic limits, custom features, private orgs), feature/resource
// catalog editor, subscriptions list with lifecycle actions, and the financial ledger.
import { useState } from "react";
import { Pressable, View } from "react-native";

import { fmtDate, money } from "@/src/api";
import { useApi, useMutate } from "@/src/hooks";
import { MODULE_LABELS } from "@/src/pro";
import { radius, spacing, useTheme } from "@/src/theme";
import { Badge, Btn, Card, Empty, Field, Loading, Segments, Sheet, T } from "@/src/ui";
import { SUB_STATUS } from "@/src/components/UsageMeters";

const LEGACY = ["employees", "distributors", "customers"];

export function useCatalog() {
  return useApi<any>("/billing/catalog");
}

// Inside the plan editor: limits for catalog resources (beyond the 3 legacy ones), custom features, private orgs.
export function PlanExtras({ plan, setPlan }: { plan: any; setPlan: (p: any) => void }) {
  const cat = useCatalog();
  const { colors } = useTheme();
  const res = (cat.data?.resources ?? []).filter((r: any) => !LEGACY.includes(r.key));
  const custom = (cat.data?.features ?? []).filter((f: any) => !(f.key in MODULE_LABELS));
  const mods: string[] = plan.modules ?? [];
  return (
    <View style={{ gap: spacing.sm }} testID="plan-extras">
      <T v="label">حدود الموارد الإضافية (فارغ = بلا حد)</T>
      {res.map((r: any) => (
        <Field key={r.key} testID={`plan-limit-${r.key}`} label={r.label} keyboardType="number-pad" value={plan.limits?.[r.key] == null ? "" : String(plan.limits[r.key])}
          onChangeText={(v) => setPlan({ ...plan, limits: { ...(plan.limits ?? {}), [r.key]: v.replace(/\D/g, "") === "" ? null : +v.replace(/\D/g, "") } })} />
      ))}
      {!!custom.length && <T v="label">مميزات مخصّصة</T>}
      {custom.map((f: any) => {
        const on = mods.includes(f.key);
        return (
          <Pressable key={f.key} testID={`plan-feature-${f.key}`} onPress={() => setPlan({ ...plan, modules: on ? mods.filter((m) => m !== f.key) : [...mods, f.key] })}
            style={{ minHeight: 44, flexDirection: "row", alignItems: "center", padding: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: on ? colors.brandPrimary : colors.border }}>
            <T style={{ flex: 1 }}>{f.label}</T>
            <Badge text={on ? "مفعّلة" : "معطّلة"} tone={on ? "success" : "warning"} />
          </Pressable>
        );
      })}
      <Field testID="plan-org-ids-input" label="خطة مخصّصة لمؤسسات محددة (معرّفات مفصولة بفاصلة، فارغ = للجميع)" value={plan.org_ids_text ?? (plan.org_ids ?? []).join(", ")}
        onChangeText={(v) => setPlan({ ...plan, org_ids_text: v })} />
    </View>
  );
}
export const extrasBody = (p: any) => ({
  limits: p.limits ?? {},
  org_ids: String(p.org_ids_text ?? (p.org_ids ?? []).join(",")).split(/[,\s]+/).map((s) => s.trim()).filter(Boolean),
});

export function DevCatalog() {
  const cat = useCatalog();
  const save = useMutate<any>("PUT", "/dev/billing/catalog", "تم حفظ الكتالوج");
  const [kind, setKind] = useState<"features" | "resources">("features");
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  if (!cat.data) return <Loading />;
  const add = () => {
    const next = { ...cat.data, [kind]: [...cat.data[kind], { key: key.trim().toLowerCase(), label: label.trim() }] };
    save.mutate(next, { onSuccess: () => { setKey(""); setLabel(""); } } as any);
  };
  return (
    <View style={{ gap: spacing.md }} testID="dev-catalog">
      <T v="caption">المميزات والموارد هنا تظهر في محرر الخطط مباشرةً دون تحديث التطبيق. المفاتيح دائمة ولا يمكن حذفها.</T>
      {(["features", "resources"] as const).map((k) => (
        <Card key={k} style={{ gap: spacing.xs }}>
          <T v="label">{k === "features" ? "المميزات" : "الموارد ذات الحدود"}</T>
          {cat.data[k].map((x: any) => <T key={x.key} v="caption" testID={`catalog-${k}-${x.key}`}>• {x.label} ({x.key})</T>)}
        </Card>
      ))}
      <View style={{ marginHorizontal: -spacing.lg }}>
        <Segments value={kind} onChange={setKind} options={[{ key: "features", label: "ميزة جديدة" }, { key: "resources", label: "مورد جديد" }]} />
      </View>
      <Field testID="catalog-key-input" label="المفتاح (إنجليزي، مثل: warehouses)" value={key} onChangeText={setKey} autoCapitalize="none" />
      <Field testID="catalog-label-input" label="الاسم الظاهر" value={label} onChangeText={setLabel} />
      <Btn testID="catalog-add-button" title="إضافة" icon="add" loading={save.isPending} disabled={!key.trim() || !label.trim()} onPress={add} />
    </View>
  );
}

const FILTERS = [{ key: "", label: "الكل" }, { key: "ACTIVE", label: "النشطة" }, { key: "EXPIRED", label: "المنتهية" }, { key: "FROZEN", label: "المجمّدة" }, { key: "SUSPENDED", label: "الموقوفة" }, { key: "FREE", label: "المجانية" }];

export function DevSubscriptions() {
  const [f, setF] = useState("");
  const subs = useApi<any[]>(`/dev/subscriptions${f ? `?status=${f}` : ""}`);
  const [sel, setSel] = useState<any>(null);
  const [days, setDays] = useState("30");
  const [note, setNote] = useState("");
  const act = useMutate<any>("POST", (b) => `/dev/subscriptions/${b.id}/action`, "تم تنفيذ الإجراء", () => setSel(null));
  const run = (action: string) => act.mutate({ id: sel.id, action, days: +days || 0, note });
  return (
    <View style={{ gap: spacing.md }} testID="dev-subscriptions">
      <View style={{ marginHorizontal: -spacing.lg }}><Segments value={f} onChange={setF} options={FILTERS} /></View>
      {subs.isLoading ? <Loading /> : !subs.data?.length ? <Empty icon="business-outline" text="لا توجد اشتراكات" /> : subs.data.map((o) => {
        const st = SUB_STATUS[o.state] ?? SUB_STATUS.FREE;
        return (
          <Card key={o.id} testID={`dev-sub-${o.id}`} onPress={() => { setSel(o); setNote(""); }} style={{ gap: spacing.xs }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
              <T v="label" style={{ flex: 1 }}>{o.name}</T>
              <Badge text={st.t} tone={st.tone} />
            </View>
            <T v="caption">{o.plan_name ?? o.plan} · {o.expires_at ? `حتى ${fmtDate(o.expires_at).split(" ")[0]}` : "—"}</T>
          </Card>
        );
      })}
      <Sheet testID="dev-sub-sheet" visible={!!sel} onClose={() => setSel(null)} title={sel?.name ?? ""}>
        {sel && (
          <View style={{ gap: spacing.sm }}>
            <T v="caption">{sel.plan_name ?? sel.plan} · {SUB_STATUS[sel.state]?.t}</T>
            <Field testID="dev-sub-days-input" label="أيام التمديد" keyboardType="number-pad" value={days} onChangeText={setDays} />
            <Field testID="dev-sub-note-input" label="ملاحظة (تُرسل للمالك وتُسجّل)" value={note} onChangeText={setNote} />
            <Btn testID="dev-sub-extend" title={`تمديد ${days} يوم`} icon="calendar-outline" loading={act.isPending} onPress={() => run("extend")} />
            <View style={{ flexDirection: "row", gap: spacing.sm }}>
              {sel.state === "FROZEN"
                ? <Btn testID="dev-sub-unfreeze" style={{ flex: 1 }} small variant="secondary" title="إلغاء التجميد" onPress={() => run("unfreeze")} />
                : <Btn testID="dev-sub-freeze" style={{ flex: 1 }} small variant="secondary" title="تجميد" onPress={() => run("freeze")} />}
              {sel.state === "SUSPENDED"
                ? <Btn testID="dev-sub-reactivate" style={{ flex: 1 }} small variant="secondary" title="إعادة التفعيل" onPress={() => run("reactivate")} />
                : <Btn testID="dev-sub-suspend" style={{ flex: 1 }} small variant="danger" title="إيقاف" onPress={() => run("suspend")} />}
            </View>
            <T v="caption">للترقية أو التخفيض لخطة أخرى استخدم «تعيين خطة» من شاشة الشركة.</T>
          </View>
        )}
      </Sheet>
    </View>
  );
}

export function DevLedger() {
  const led = useApi<any[]>("/dev/billing/ledger");
  if (led.isLoading) return <Loading />;
  if (!led.data?.length) return <Empty icon="cash-outline" text="لا توجد عمليات مالية بعد" />;
  const totals: Record<string, number> = {};
  for (const r of led.data) totals[r.currency ?? "?"] = (totals[r.currency ?? "?"] ?? 0) + (r.amount ?? 0);
  return (
    <View style={{ gap: spacing.sm }} testID="dev-ledger">
      <T v="label" testID="ledger-total">الصافي: {Object.entries(totals).map(([c, v]) => `${money(v)} ${c}`).join(" · ")}</T>
      {led.data.map((r: any, i: number) => (
        <Card key={i} testID={`ledger-row-${i}`} style={{ gap: 2 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
            <T v="label" style={{ flex: 1 }}>{r.org_name}</T>
            <Badge text={r.type === "REFUND" ? "استرداد" : r.type === "RENEWAL" ? "تجديد" : "دفعة"} tone={r.type === "REFUND" ? "error" : "success"} />
          </View>
          <T v="caption">{r.ref_code} · {r.plan_name} · {money(r.amount)} {r.currency}{r.credit ? ` (خصم ترقية ${money(r.credit)})` : ""} · {r.method_name} · {fmtDate(r.created_at)}</T>
        </Card>
      ))}
    </View>
  );
}
