import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";

import { useAuth } from "@/src/auth";
import { useApi } from "@/src/hooks";
import { radius, spacing, useTheme } from "@/src/theme";
import { Btn, Card, IconName, Ionicons, T } from "@/src/ui";
import { storage } from "@/src/utils/storage";

type Step = { done: boolean; icon: IconName; title: string; desc: string; cta: string; onPress: () => void; testID: string };

// First-run checklist for a new owner: add the first product, then invite the first distributor.
// Progress auto-detects from live data; the card hides for good once both steps are done or dismissed.
export function OwnerOnboarding() {
  const { user } = useAuth();
  const router = useRouter();
  const { colors } = useTheme();
  const isOwner = user?.role === "OWNER";
  const orgId = user?.org?.id ?? "";
  const key = `onboarding_owner_done_${orgId}`;
  const [dismissed, setDismissed] = useState<boolean | null>(null);

  const stats = useApi<any>("/stats/overview", isOwner);
  const emps = useApi<any>("/employees", isOwner);

  useEffect(() => {
    storage.getItem(key, false).then((v) => setDismissed(!!v));
  }, [key]);

  const hasProduct = (stats.data?.products ?? 0) > 0;
  const agents = (emps.data?.employees ?? []).filter((e: any) => e.employee_type === "FIELD_AGENT");
  const pendingAgentInvites = (emps.data?.invitations ?? []).filter((i: any) => i.employee_type === "FIELD_AGENT");
  const hasDistributor = agents.length > 0 || pendingAgentInvites.length > 0;
  const allDone = hasProduct && hasDistributor;

  // Persist completion so a brief guide never nags again once both steps are met.
  useEffect(() => {
    if (allDone && dismissed === false) storage.setItem(key, true);
  }, [allDone, dismissed, key]);

  if (!isOwner) return null;
  if (dismissed === null) return null; // flag still loading
  if (dismissed || allDone) return null;
  if (stats.isLoading || emps.isLoading) return null; // avoid flicker before data

  const dismiss = () => {
    storage.setItem(key, true);
    setDismissed(true);
  };

  const steps: Step[] = [
    {
      done: hasProduct,
      icon: "cube-outline",
      title: "أضف أول منتج للمخزون",
      desc: "سجّل منتجاتك بأسعار البيع والتكلفة والكميات لتبدأ البيع.",
      cta: "إضافة منتج",
      testID: "onboarding-cta-product",
      onPress: () => router.push("/owner/products?new=1" as any),
    },
    {
      done: hasDistributor,
      icon: "person-add-outline",
      title: "ادعُ أول موزع ميداني",
      desc: "أنشئ رمز دعوة ليفعّل الموزع حسابه ويبدأ البيع والتحصيل.",
      cta: "دعوة موزع",
      testID: "onboarding-cta-distributor",
      onPress: () => router.push("/owner/more?invite=1" as any),
    },
  ];
  const doneCount = steps.filter((s) => s.done).length;

  return (
    <Card testID="owner-onboarding-card" style={{ gap: spacing.lg, borderColor: colors.brandPrimary, borderWidth: 1.5 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
        <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" }}>
          <Ionicons name="rocket-outline" size={24} color={colors.brandPrimary} />
        </View>
        <View style={{ flex: 1 }}>
          <T v="h2">لنبدأ تشغيل نظامك</T>
          <T v="caption">خطوتان سريعتان للانطلاق · {doneCount} من {steps.length}</T>
        </View>
        <Pressable testID="onboarding-dismiss-button" onPress={dismiss} hitSlop={8}>
          <Ionicons name="close" size={20} color={colors.muted} />
        </Pressable>
      </View>

      <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.surfaceSecondary, overflow: "hidden" }}>
        <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.brandPrimary, width: `${(doneCount / steps.length) * 100}%` }} />
      </View>

      {steps.map((s, i) => (
        <View key={i} testID={`onboarding-step-${i}`} style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
          <View
            style={{
              width: 34,
              height: 34,
              borderRadius: 17,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: s.done ? colors.success : colors.surfaceSecondary,
              borderWidth: s.done ? 0 : 1,
              borderColor: colors.border,
            }}
          >
            <Ionicons name={s.done ? "checkmark" : s.icon} size={18} color={s.done ? colors.onSuccess : colors.brandPrimary} />
          </View>
          <View style={{ flex: 1 }}>
            <T v="label" style={s.done ? { textDecorationLine: "line-through", color: colors.muted } : undefined}>{s.title}</T>
            {!s.done && <T v="caption">{s.desc}</T>}
          </View>
          {!s.done && <Btn small testID={s.testID} title={s.cta} onPress={s.onPress} style={{ borderRadius: radius.md }} />}
        </View>
      ))}
    </Card>
  );
}
