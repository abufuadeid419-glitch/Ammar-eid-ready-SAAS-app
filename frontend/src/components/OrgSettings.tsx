import { useState } from "react";
import { Platform, Switch, View } from "react-native";
import { useRouter } from "expo-router";

import { PricingMethodPicker } from "@/src/components/PricingMethod";
import { backupHtml } from "@/src/backupPdf";
import { shareHtmlPdf } from "@/src/printDoc";
import { api, fmtDate } from "@/src/api";
import { useAuth } from "@/src/auth";
import { useApi, useMutate } from "@/src/hooks";
import { ProLock } from "@/src/components/ProLock";
import { spacing, useTheme } from "@/src/theme";
import { Badge, Btn, Card, Field, Section, T, useToast } from "@/src/ui";

// Evening SMS (21:00) to the owner with today's sales, collections and new debts.
function DailySmsSection() {
  const { colors } = useTheme();
  const q = useApi<{ enabled: boolean; phone: string | null; text: string }>("/org/daily-sms");
  const save = useMutate("PUT", "/org/daily-sms", "تم حفظ الإعداد");
  const test = useMutate("POST", "/org/daily-sms/test", "تم إرسال ملخص اليوم إلى هاتفك");
  const enabled = q.data?.enabled ?? true;
  return (
    <Section title="ملخص SMS اليومي">
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
        <View style={{ flex: 1 }}>
          <T v="label">إرسال ملخص مسائي (9:00 م)</T>
          <T v="caption">المبيعات والتحصيلات والديون الجديدة لليوم، برسالة SMS إلى {q.data?.phone ?? "رقم المالك"}</T>
        </View>
        <Switch
          testID="daily-sms-switch"
          value={enabled}
          disabled={q.isLoading || save.isPending}
          onValueChange={(v) => save.mutate({ enabled: v })}
          trackColor={{ true: colors.brandPrimary, false: colors.border }}
          thumbColor={colors.surface}
        />
      </View>
      {!!q.data?.text && (
        <Card testID="daily-sms-preview" style={{ gap: spacing.xs, backgroundColor: colors.surfaceSecondary }}>
          <T v="caption">معاينة رسالة اليوم</T>
          <T>{q.data.text}</T>
        </Card>
      )}
      <Btn testID="daily-sms-test-button" small variant="secondary" icon="send-outline" title="أرسل ملخص اليوم الآن" loading={test.isPending} disabled={!q.data?.phone} onPress={() => test.mutate({})} />
    </Section>
  );
}

// Automatic SMS debt reminders: owner enables and picks the period; each debtor gets one SMS per period.
const PERIODS = [7, 14, 30] as const;
function DebtSmsSection() {
  const { colors } = useTheme();
  const q = useApi<{ enabled: boolean; days: number; eligible: number; sample: string }>("/org/debt-sms");
  const save = useMutate("PUT", "/org/debt-sms", "تم حفظ إعداد تذكير الديون");
  const enabled = q.data?.enabled ?? false;
  const days = q.data?.days ?? 14;
  return (
    <Section title="تذكير الديون عبر SMS">
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
        <View style={{ flex: 1 }}>
          <T v="label">إرسال تذكير تلقائي للعملاء المدينين</T>
          <T v="caption">رسالة SMS واحدة لكل عميل عليه رصيد مستحق، مرة كل {days} يوماً (العملاء الذين لديهم رقم هاتف)</T>
        </View>
        <Switch
          testID="debt-sms-switch"
          value={enabled}
          disabled={q.isLoading || save.isPending}
          onValueChange={(v) => save.mutate({ enabled: v, days })}
          trackColor={{ true: colors.brandPrimary, false: colors.border }}
          thumbColor={colors.surfaceSecondary}
        />
      </View>
      <View style={{ flexDirection: "row", gap: spacing.sm }}>
        {PERIODS.map((d) => (
          <Btn key={d} testID={`debt-sms-days-${d}`} small style={{ flex: 1 }} variant={days === d ? "primary" : "secondary"} title={`كل ${d} يوم`} disabled={save.isPending} onPress={() => save.mutate({ enabled, days: d })} />
        ))}
      </View>
      {!!q.data && (
        <Card testID="debt-sms-preview" style={{ gap: spacing.xs, backgroundColor: colors.surfaceTertiary }}>
          <T v="caption" testID="debt-sms-eligible">مستحق للتذكير الآن: {q.data.eligible} عميل · يُرسل يومياً الساعة 10:00 ص</T>
          <T>{q.data.sample}</T>
        </Card>
      )}
    </Section>
  );
}

// Owner settings: currencies, data backup export, and organization deletion request.
export function OrgSettings() {
  const toast = useToast();
  const { user, refresh } = useAuth();
  const org = user?.org ?? {};
  const [cur, setCur] = useState({ currency: org.currency ?? "ل.س", alt_currency: org.alt_currency ?? "", exchange_rate: String(org.exchange_rate ?? "") });
  const saveCur = useMutate("PUT", "/org/currency", "تم حفظ إعدادات العملة", () => refresh());
  const [confirmDel, setConfirmDel] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const router = useRouter();
  const deleteOrg = async () => {
    setDeleting(true);
    try {
      await api("/auth/account", { method: "DELETE" });
      router.replace("/goodbye" as any);
    } catch (e: any) {
      toast(e.message, "error");
    } finally {
      setDeleting(false);
    }
  };
  const [exporting, setExporting] = useState(false);

  const exportBackup = async () => {
    setExporting(true);
    try {
      // PDF only, with readable business data (no ids / codes / database structure).
      const data = await api("/backup/export");
      await shareHtmlPdf(backupHtml(data), `نسخة احتياطية - ${data?.organization?.name ?? ""} - ${new Date().toISOString().slice(0, 10)}`);
      toast("تم تصدير النسخة الاحتياطية");
    } catch (e: any) {
      toast(e.message, "error");
    } finally {
      setExporting(false);
    }
  };

  return (
    <View style={{ gap: spacing.xl }} testID="org-settings">
      <Section title="العملات">
        <View style={{ flexDirection: "row", gap: spacing.md }}>
          <View style={{ flex: 1 }}><Field testID="currency-input" label="العملة الأساسية" value={cur.currency} onChangeText={(v) => setCur({ ...cur, currency: v })} /></View>
          <View style={{ flex: 1 }}><Field testID="alt-currency-input" label="عملة ثانوية" placeholder="USD" value={cur.alt_currency} onChangeText={(v) => setCur({ ...cur, alt_currency: v })} /></View>
        </View>
        <Field testID="exchange-rate-input" label={`سعر الصرف (1 ${cur.alt_currency || "عملة ثانوية"} = ? ${cur.currency})`} keyboardType="decimal-pad" value={cur.exchange_rate} onChangeText={(v) => setCur({ ...cur, exchange_rate: v })} />
        <Btn testID="save-currency-button" small title="حفظ العملات" icon="checkmark" loading={saveCur.isPending} onPress={() => saveCur.mutate({ ...cur, exchange_rate: +cur.exchange_rate || 0 })} />
      </Section>

      <ProLock testID="lock-daily-sms" module="daily_sms" feature="ملخص SMS اليومي">
        <DailySmsSection />
      </ProLock>
      <ProLock testID="lock-debt-sms" module="debt_sms" feature="تذكير الديون التلقائي عبر SMS">
        <DebtSmsSection />
      </ProLock>

      <Section title="سياسة التسعير عند تغيّر التكلفة">
        <PricingMethodPicker />
      </Section>

      <Section title="النسخ الاحتياطي">
        <T v="caption">صدّر جميع بيانات المؤسسة (المنتجات، العملاء، الفواتير، التحصيلات، المشتريات...) كملف JSON.</T>
        <Btn testID="export-backup-button" variant="secondary" icon="cloud-download-outline" title="تصدير نسخة احتياطية (PDF)" loading={exporting} onPress={exportBackup} />
      </Section>

      <Section title="حذف المؤسسة والحساب">
        {confirmDel ? (
          <Card style={{ gap: spacing.sm }} testID="org-delete-confirm-card">
            <T color="error">سيتم حذف المؤسسة وجميع بياناتها وحسابك نهائياً، ويُفصل جميع الموظفين. لا يمكن التراجع.</T>
            <Btn testID="confirm-org-delete-button" small variant="danger" icon="trash" title="نعم، احذف نهائياً" loading={deleting} onPress={deleteOrg} />
            <Btn testID="cancel-org-delete-button" small variant="ghost" title="إلغاء" onPress={() => setConfirmDel(false)} />
          </Card>
        ) : (
          <>
            <T v="caption">يمكن للمالك حذف المؤسسة وحسابه مباشرة. ننصح بتصدير نسخة احتياطية أولاً.</T>
            <Btn testID="request-deletion-button" small variant="danger" icon="trash-outline" title="حذف المؤسسة وحسابي" onPress={() => setConfirmDel(true)} />
          </>
        )}
      </Section>
    </View>
  );
}
