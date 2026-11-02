import { useState } from "react";
import { Pressable, View } from "react-native";

import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { queryClient } from "@/src/query-client";
import { radius, spacing, useTheme } from "@/src/theme";
import { Btn, Ionicons, Sheet, T, useToast } from "@/src/ui";

export type PricingMethod = "FIFO" | "WAVG" | "LATEST";

const OPTIONS: { key: PricingMethod; title: string; desc: string; icon: any }[] = [
  { key: "FIFO", title: "الوارد أولاً صادر أولاً (FIFO)", desc: "تُباع البضاعة القديمة بسعرها القديم أولاً، وعند نفادها ينتقل سعر البيع تلقائياً لسعر الدفعة الجديدة.", icon: "layers-outline" },
  { key: "WAVG", title: "المتوسط المرجّح", desc: "تُحسب تكلفة موحدة من الكمية القديمة والجديدة، ويُعدَّل سعر البيع بنفس نسبة الربح ويُعتمد سعراً موحداً.", icon: "git-merge-outline" },
  { key: "LATEST", title: "اعتماد السعر الجديد على كل البضاعة", desc: "تُعتمد تكلفة البضاعة الجديدة وسعرها (بنفس نسبة الربح) على كل الكمية المتوفرة من نفس المادة فوراً.", icon: "trending-up-outline" },
];

// Owner's rule for sale prices when a purchase arrives at a different cost.
export function PricingMethodPicker({ onSaved, compact }: { onSaved?: (m: PricingMethod) => void; compact?: boolean }) {
  const { colors } = useTheme();
  const toast = useToast();
  const { user, refresh } = useAuth();
  const current = user?.org?.pricing_method as PricingMethod | undefined;
  const [sel, setSel] = useState<PricingMethod | undefined>(current);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!sel) return toast("اختر طريقة التسعير", "error");
    setSaving(true);
    try {
      await api("/org/pricing-method", { method: "PUT", body: { method: sel } });
      await refresh();
      queryClient.invalidateQueries();
      toast("تم حفظ سياسة التسعير");
      onSaved?.(sel);
    } catch (e: any) {
      toast(e.message, "error");
    } finally {
      setSaving(false);
    }
  };
  return (
    <View style={{ gap: spacing.md }} testID="pricing-method-picker">
      {!compact && <T v="caption">عند ارتفاع أو انخفاض تكلفة الشراء، كيف يُحدَّد سعر البيع للبضاعة القديمة والجديدة؟</T>}
      {OPTIONS.map((o) => {
        const on = sel === o.key;
        return (
          <Pressable
            key={o.key}
            testID={`pricing-method-${o.key.toLowerCase()}`}
            onPress={() => setSel(o.key)}
            style={{ flexDirection: "row", gap: spacing.md, padding: spacing.md, borderRadius: radius.md, borderWidth: on ? 2 : 1, borderColor: on ? colors.brandPrimary : colors.border, backgroundColor: on ? colors.brandTertiary : colors.surfaceSecondary }}
          >
            <Ionicons name={o.icon} size={22} color={on ? colors.brandPrimary : colors.muted} />
            <View style={{ flex: 1, gap: 2 }}>
              <T v="label">{o.title}</T>
              <T v="caption">{o.desc}</T>
            </View>
            <Ionicons name={on ? "radio-button-on" : "radio-button-off"} size={20} color={on ? colors.brandPrimary : colors.muted} />
          </Pressable>
        );
      })}
      <Btn testID="save-pricing-method-button" small icon="checkmark" title={current && current === sel ? "محفوظة" : "حفظ سياسة التسعير"} disabled={!sel || sel === current} loading={saving} onPress={save} />
    </View>
  );
}

// Shown when a purchase changes the cost while old goods are still on hand and no policy is set yet.
export function PricingMethodSheet({ visible, onClose, onSaved }: { visible: boolean; onClose: () => void; onSaved: (m: PricingMethod) => void }) {
  return (
    <Sheet testID="pricing-method-sheet" visible={visible} onClose={onClose} title="سياسة التسعير عند تغيّر التكلفة">
      <T v="caption">تكلفة هذه المشتريات مختلفة عن تكلفة البضاعة الموجودة. اختر القاعدة التي ستُطبَّق الآن ومستقبلاً (يمكن تغييرها من الإدارة ← ملف المؤسسة).</T>
      <PricingMethodPicker compact onSaved={onSaved} />
    </Sheet>
  );
}
