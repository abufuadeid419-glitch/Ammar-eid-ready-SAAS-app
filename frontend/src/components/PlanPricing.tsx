import { useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, View } from "react-native";

import { money } from "@/src/api";
import { useApi } from "@/src/hooks";
import { isPro, priceFor, promoOn, tierLabel, usePro } from "@/src/pro";
import { radius, spacing, useTheme } from "@/src/theme";
import { Badge, Btn, Ionicons, Section, Segments, T } from "@/src/ui";

const lim = (n: any, unit: string) => (n == null ? `${unit} بلا حد` : `حتى ${n} ${unit}`);

// Owner dashboard: live Pro / VIP pricing from the published plans, with a one-tap upgrade that
// opens checkout for that plan on the plans page.
export function PlanPricing() {
  const router = useRouter();
  const { colors } = useTheme();
  const { org, isOwner } = usePro();
  const plans = useApi<any[]>("/plans", isOwner);
  const [billing, setBilling] = useState<"monthly" | "yearly">("monthly");
  if (!isOwner || !plans.data) return null;

  const paid = plans.data.filter((p) => p.tier !== "FREE");
  const hasVip = paid.some((p) => p.tier === "VIP");
  const hasYearly = paid.some((p) => p.yearly_price);
  const active = isPro(org);
  if (!paid.length) return null;

  const upgrade = (p: any) => router.push({ pathname: "/upgrade", params: { plan: p.id, billing } } as any);
  // Only call yearly "best value" when it really is cheaper than 12 monthly payments.
  const yearlySaves = paid.some((p) => p.yearly_price && priceFor(p, "monthly") != null && p.yearly_price < priceFor(p, "monthly") * (365 / (p.days || 30)));

  return (
    <Section
      title="خطط Pro و VIP"
      hint={active ? "ارتقِ بخطتك أو جدّدها في أي وقت" : "افتح التقارير، تتبع الموزعين وتذكير الديون"}
      action={<Btn testID="pricing-compare-button" small variant="ghost" title="مقارنة الخطط" style={{ minHeight: 44 }} onPress={() => router.push("/upgrade")} />}
    >
      <View testID="plan-pricing-card" style={{ gap: spacing.md }}>
        {hasYearly && (
          <View testID="pricing-billing-toggle" style={{ marginHorizontal: -spacing.lg }}>
            <Segments value={billing} onChange={setBilling} options={[{ key: "monthly", label: "شهري" }, { key: "yearly", label: yearlySaves ? "سنوي (الأوفر)" : "سنوي" }]} />
          </View>
        )}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.md, paddingVertical: spacing.xs }} style={{ marginHorizontal: -spacing.lg }}>
          <View style={{ width: spacing.lg - spacing.md }} />
          {paid.map((p) => {
            const price = priceFor(p, billing);
            const current = active && org?.plan_id === p.id;
            const vip = p.tier === "VIP";
            return (
              <View
                key={p.id}
                testID={`pricing-plan-${p.tier.toLowerCase()}`}
                style={{
                  width: 260,
                  flexShrink: 0,
                  gap: spacing.sm,
                  padding: spacing.lg,
                  borderRadius: radius.lg,
                  borderWidth: p.recommended || vip ? 1.5 : 1,
                  borderColor: p.recommended || vip ? colors.pro : colors.border,
                  backgroundColor: vip ? colors.brandTertiary : colors.surfaceSecondary,
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                  <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: colors.pro, alignItems: "center", justifyContent: "center" }}>
                    <Ionicons name={vip ? "star" : "diamond-outline"} size={16} color={colors.onPro} />
                  </View>
                  <T v="h2" style={{ flex: 1 }} numberOfLines={1}>{p.name}</T>
                  {current ? <Badge text="خطتك" tone="success" /> : p.recommended ? <Badge text="الأكثر طلباً" tone="pro" /> : <Badge text={tierLabel(p.tier)} tone="pro" />}
                </View>
                <View style={{ flexDirection: "row", alignItems: "baseline", gap: spacing.xs }}>
                  <T v="title" color="brandPrimary" testID={`pricing-price-${p.tier.toLowerCase()}`}>{price == null ? "غير متاح" : `${money(price)} ${p.currency}`}</T>
                  {price != null && <T v="caption">/ {billing === "yearly" ? "سنة" : `${p.days} يوم`}</T>}
                </View>
                {billing === "monthly" && promoOn(p) && p.promo_price < p.price && (
                  <T v="caption" style={{ textDecorationLine: "line-through" }}>{money(p.price)} {p.currency}</T>
                )}
                <T v="caption">{lim(p.max_employees, "موظف")} · {lim(p.max_distributors, "موزع")} · {lim(p.max_customers, "عميل")}</T>
                <Btn
                  testID={`pricing-upgrade-${p.tier.toLowerCase()}`}
                  title={current ? "تجديد الخطة" : `الترقية إلى ${tierLabel(p.tier)}`}
                  icon="arrow-back"
                  disabled={price == null}
                  onPress={() => upgrade(p)}
                />
              </View>
            );
          })}
          {!hasVip && (
            <View testID="pricing-plan-vip" style={{ width: 220, flexShrink: 0, gap: spacing.sm, padding: spacing.lg, borderRadius: radius.lg, borderWidth: 1, borderStyle: "dashed", borderColor: colors.pro, backgroundColor: colors.brandTertiary, justifyContent: "space-between" }}>
              <View style={{ gap: spacing.xs }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                  <Ionicons name="star" size={18} color={colors.pro} />
                  <T v="h2">VIP</T>
                </View>
                <T v="caption">للشركات الكبيرة: حدود أعلى ودعم مخصّص. السعر حسب حجم شركتك.</T>
              </View>
              <Btn testID="pricing-vip-contact" small variant="secondary" icon="chatbubbles-outline" title="اطلب عرض سعر" style={{ minHeight: 44 }} onPress={() => router.push("/upgrade")} />
            </View>
          )}
          <View style={{ width: spacing.lg - spacing.md }} />
        </ScrollView>
      </View>
    </Section>
  );
}
