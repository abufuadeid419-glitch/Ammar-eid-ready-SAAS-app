import { useMutation } from "convex/react";

import { useApi } from "@/src/hooks";
import { useState } from "react";
import { View } from "react-native";

import { api as cxApi } from "@/convex/_generated/api";
import { money } from "@/src/api";
import { useAuth } from "@/src/auth";
import { radius, spacing, useTheme } from "@/src/theme";
import { Btn, Card, Empty, Field, IconBtn, Loading, Section, Sheet, T, useToast } from "@/src/ui";

function Progress({ pct, testID }: { pct: number | null; testID?: string }) {
  const { colors } = useTheme();
  const p = pct ?? 0;
  const color = p >= 100 ? colors.success : p >= 60 ? colors.brandPrimary : p >= 30 ? colors.warning : colors.error;
  return (
    <View testID={testID} style={{ height: 8, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary, overflow: "hidden" }}>
      <View style={{ height: 8, width: `${Math.min(100, Math.max(p > 0 ? 2 : 0, p))}%`, backgroundColor: color, borderRadius: radius.pill }} />
    </View>
  );
}

// Owner / accountant: live progress of every distributor; owner can set targets.
export function SalesTargetsCard() {
  const { token, user } = useAuth();
  const toast = useToast();
  const isOwner = user?.role === "OWNER";
  const tq = useApi<any>("/targets", !!token, 60000);
  const q = tq.data; // REST: a failed query must never crash the screen
  const setTarget = useMutation(cxApi.targets.set);
  const [edit, setEdit] = useState<any>(null);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!token || !edit) return;
    const n = Number(amount.replace(/,/g, ""));
    if (!Number.isFinite(n) || n < 0) return toast("أدخل مبلغاً صحيحاً", "error");
    setBusy(true);
    try {
      await setTarget({ token, distributor_id: edit.user_id, month: q?.month, amount: n });
      tq.refetch();
      toast(n === 0 ? "تم حذف الهدف" : "تم حفظ الهدف");
      setEdit(null);
    } catch (e: any) {
      toast(String(e?.message ?? e).replace(/^.*Uncaught Error: /, "").split("\n")[0], "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="أهداف المبيعات الشهرية">
      <Card testID="sales-targets-card" style={{ gap: spacing.lg }}>
        {q === undefined ? (
          <Loading />
        ) : !q.agents.length ? (
          <Empty icon="flag-outline" text="لا يوجد موزعون بعد" />
        ) : (
          <>
            <T v="caption" testID="targets-days-left">متبقٍ {q.days_left} يوماً على نهاية الشهر · تحديث لحظي</T>
            {q.agents.map((a: any) => (
              <View key={a.user_id} testID={`target-row-${a.user_id}`} style={{ gap: spacing.xs }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                  <View style={{ flex: 1 }}>
                    <T v="label" numberOfLines={1}>{a.name}</T>
                    <T v="caption">{a.target ? `${money(a.achieved)} من ${money(a.target)}` : `محقق ${money(a.achieved)} · بدون هدف`}</T>
                  </View>
                  {a.pct != null && <T v="h2" testID={`target-pct-${a.user_id}`} color={a.pct >= 100 ? "success" : "brandPrimary"}>{a.pct}%</T>}
                  {isOwner && <IconBtn testID={`edit-target-${a.user_id}`} icon={a.target ? "create-outline" : "flag-outline"} onPress={() => { setEdit(a); setAmount(a.target ? String(a.target) : ""); }} />}
                </View>
                {!!a.target && <Progress pct={a.pct} testID={`target-progress-${a.user_id}`} />}
              </View>
            ))}
          </>
        )}
      </Card>
      <Sheet
        testID="target-sheet"
        visible={!!edit}
        onClose={() => setEdit(null)}
        title={`هدف ${edit?.name ?? ""}`}
        footer={<Btn testID="save-target-button" title="حفظ الهدف" icon="checkmark" loading={busy} onPress={save} />}
      >
        <Field testID="target-amount-input" label={`هدف المبيعات لشهر ${q?.month ?? ""}`} keyboardType="decimal-pad" value={amount} onChangeText={setAmount} placeholder="مثال: 5000" />
        <T v="caption">أدخل 0 لحذف الهدف. يتم احتساب صافي المبيعات (بعد المرتجعات).</T>
      </Sheet>
    </Section>
  );
}

// Field agent: own target with pace guidance.
export function MyTargetCard() {
  const { token } = useAuth();
  const tq = useApi<any>("/targets", !!token, 60000);
  const q = tq.data; // REST: a failed query must never crash the screen
  const me = q?.agents?.[0];
  if (!me?.target) return null;
  const done = (me.pct ?? 0) >= 100;
  return (
    <Card testID="my-target-card" style={{ gap: spacing.sm }}>
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <T v="label" style={{ flex: 1 }}>هدفي هذا الشهر</T>
        <T v="h2" testID="my-target-pct" color={done ? "success" : "brandPrimary"}>{me.pct}%</T>
      </View>
      <Progress pct={me.pct} testID="my-target-progress" />
      <T v="caption" testID="my-target-summary">{money(me.achieved)} من {money(me.target)}</T>
      <T v="caption" color={done ? "success" : "muted"} testID="my-target-pace">
        {done ? "أحسنت! حققت هدفك لهذا الشهر" : q.days_left > 0 ? `متبقٍ ${money(me.remaining)} · تحتاج ${money(me.daily_needed)} يومياً لـ ${q.days_left} يوماً` : `متبقٍ ${money(me.remaining)}`}
      </T>
    </Card>
  );
}
