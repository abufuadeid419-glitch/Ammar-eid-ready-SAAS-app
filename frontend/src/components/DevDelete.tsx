// Developer-only delete controls with a confirmation sheet that explains the consequences.
import { useState } from "react";
import { View } from "react-native";

import { api } from "@/src/api";
import { queryClient } from "@/src/query-client";
import { spacing } from "@/src/theme";
import { Btn, Card, Field, Sheet, T, useToast } from "@/src/ui";

type Confirm = { title: string; body: string; path: string; body_extra?: any; typeName?: string; testID: string; done?: () => void };

export function ConfirmDelete({ c, onClose }: { c: Confirm | null; onClose: () => void }) {
  const toast = useToast();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const ok = !c?.typeName || typed.trim() === c.typeName.trim();
  const run = async () => {
    if (!c) return;
    setBusy(true);
    try {
      await api(c.path, { method: "POST", timeoutMs: 120000, body: { ...(c.body_extra ?? {}), confirm: typed } });
      toast("تم الحذف");
      queryClient.invalidateQueries();
      setTyped("");
      onClose();
      c.done?.();
    } catch (e: any) {
      toast(e.message, "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet testID="confirm-delete-sheet" visible={!!c} onClose={() => { setTyped(""); onClose(); }} title={c?.title ?? ""}
      footer={<Btn testID="confirm-delete-button" variant="danger" icon="trash-outline" title="تأكيد الحذف" loading={busy} disabled={!ok} onPress={run} />}>
      {c && (
        <View style={{ gap: spacing.md }}>
          <Card style={{ gap: spacing.xs }}>
            <T v="label" color="error">تحذير</T>
            <T testID="confirm-delete-body">{c.body}</T>
          </Card>
          {!!c.typeName && <Field testID="confirm-delete-input" label={`اكتب «${c.typeName}» للتأكيد`} value={typed} onChangeText={setTyped} />}
        </View>
      )}
    </Sheet>
  );
}

// Danger zone inside the developer's organization sheet.
export function OrgDangerZone({ org, onDone }: { org: any; onDone: () => void }) {
  const [c, setC] = useState<Confirm | null>(null);
  const deleted = org.status === "DELETED";
  return (
    <Card testID="org-danger-zone" style={{ gap: spacing.sm }}>
      <T v="label" color="error">منطقة الخطر (للمطوّر فقط)</T>
      <Btn testID="cancel-subscription-button" small variant="secondary" icon="close-circle-outline" title="حذف الاشتراك (الرجوع للخطة المجانية)"
        onPress={() => setC({ testID: "cancel-sub", title: "حذف اشتراك المؤسسة", body: `ستعود "${org.name}" إلى الخطة المجانية فوراً وتُقفل المميزات المدفوعة. البيانات لا تُحذف.`, path: `/dev/orgs/${org.id}/cancel-subscription` })} />
      <Btn testID={deleted ? "restore-org-button" : "soft-delete-org-button"} small variant="secondary" icon={deleted ? "refresh-outline" : "eye-off-outline"} title={deleted ? "استعادة المؤسسة" : "حذف مؤقت (قابل للاستعادة)"}
        onPress={() => setC({ testID: "soft", title: deleted ? "استعادة المؤسسة" : "حذف مؤقت", body: deleted ? "ستعود المؤسسة نشطة ويستعيد أعضاؤها الوصول." : "يُمنع المالك والموظفون من الدخول، وتبقى كل البيانات محفوظة ويمكن استعادتها لاحقاً.", path: `/dev/orgs/${org.id}/soft-delete`, body_extra: { restore: deleted }, done: onDone })} />
      <Btn testID="hard-delete-org-button" small variant="danger" icon="trash-outline" title="حذف نهائي للمؤسسة وكل بياناتها"
        onPress={() => setC({ testID: "hard", title: "حذف نهائي", body: "سيتم حذف كل بيانات المؤسسة نهائياً: المنتجات والعملاء والفواتير والسندات والمخزون والمسارات وطلبات الدفع وإيصالاتها. يُفصل المالك والموظفون عنها (تبقى حساباتهم دون مؤسسة). يبقى السجل المالي وسجل التدقيق. لا يمكن التراجع.", path: `/dev/orgs/${org.id}/delete`, typeName: org.name, done: onDone })} />
      <ConfirmDelete c={c} onClose={() => setC(null)} />
    </Card>
  );
}
