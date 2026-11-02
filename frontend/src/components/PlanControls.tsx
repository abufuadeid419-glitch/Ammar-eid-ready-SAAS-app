import { Pressable, View } from "react-native";

import { MODULE_LABELS } from "@/src/pro";
import { radius, spacing, useTheme } from "@/src/theme";
import { Field, Ionicons, Segments, T } from "@/src/ui";

export type PlanControlValue = { tier: string; max_employees: string; max_distributors: string; max_customers?: string; modules: string[] };

// Developer-only controls: plan tier, employee / distributor limits and which features are switched on.
export function PlanControls({ value, onChange, testPrefix, tiers = ["PRO", "VIP"] }: { value: PlanControlValue; onChange: (v: PlanControlValue) => void; testPrefix: string; tiers?: string[] }) {
  const { colors } = useTheme();
  const toggle = (k: string) =>
    onChange({ ...value, modules: value.modules.includes(k) ? value.modules.filter((m) => m !== k) : [...value.modules, k] });
  return (
    <View style={{ gap: spacing.md }} testID={`${testPrefix}-plan-controls`}>
      <T v="label">فئة الخطة</T>
      <View style={{ marginHorizontal: -spacing.lg }}>
        <Segments value={value.tier} onChange={(t) => onChange({ ...value, tier: t })} options={tiers.map((t) => ({ key: t, label: t === "FREE" ? "مجانية" : t === "VIP" ? "VIP" : "Pro" }))} />
      </View>
      <View style={{ flexDirection: "row", gap: spacing.md }}>
        <View style={{ flex: 1 }}>
          <Field testID={`${testPrefix}-max-employees-input`} label="أقصى عدد موظفين" keyboardType="number-pad" value={value.max_employees} onChangeText={(v) => onChange({ ...value, max_employees: v.replace(/\D/g, "") })} />
        </View>
        <View style={{ flex: 1 }}>
          <Field testID={`${testPrefix}-max-distributors-input`} label="أقصى عدد موزعين" placeholder="بلا حد" keyboardType="number-pad" value={value.max_distributors} onChangeText={(v) => onChange({ ...value, max_distributors: v.replace(/\D/g, "") })} />
        </View>
      </View>
      <Field testID={`${testPrefix}-max-customers-input`} label="أقصى عدد عملاء" placeholder="بلا حد" keyboardType="number-pad" value={value.max_customers ?? ""} onChangeText={(v) => onChange({ ...value, max_customers: v.replace(/\D/g, "") })} />
      <T v="label">الميزات المفعّلة</T>
      <View style={{ gap: spacing.sm }}>
        {Object.entries(MODULE_LABELS).map(([k, label]) => {
          const on = value.modules.includes(k);
          return (
            <Pressable
              key={k}
              testID={`${testPrefix}-module-${k}`}
              onPress={() => toggle(k)}
              style={{ minHeight: 48, flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: on ? colors.brandPrimary : colors.border, backgroundColor: on ? colors.brandTertiary : colors.surfaceSecondary }}
            >
              <Ionicons name={on ? "checkbox" : "square-outline"} size={22} color={on ? colors.brandPrimary : colors.muted} />
              <T style={{ flex: 1 }}>{label}</T>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export const toPlanControls = (o: any): PlanControlValue => ({
  tier: o?.tier ?? o?.plan_tier ?? "PRO",
  max_employees: String(o?.max_employees ?? 5),
  max_distributors: o?.max_distributors == null ? "" : String(o.max_distributors),
  max_customers: o?.max_customers == null ? "" : String(o.max_customers),
  modules: Array.isArray(o?.modules) ? o.modules : Object.keys(MODULE_LABELS),
});

export const fromPlanControls = (v: PlanControlValue) => ({
  max_employees: +v.max_employees || 1,
  max_distributors: v.max_distributors === "" ? null : +v.max_distributors,
  max_customers: !v.max_customers ? null : +v.max_customers,
  modules: v.modules,
});
