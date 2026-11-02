import { useAuth } from "@/src/auth";

// Pro = paid licence or the 14-day free Pro trial, while not expired.
// An expired trial drops to the Free plan (app keeps working, Pro features lock).
export const isExpired = (o: any) => {
  const end = o?.grace_until ?? o?.expires_at;
  return !!end && Date.parse(end) < Date.now();
};
export const isPro = (o: any) => !!o && o.status === "ACTIVE" && !isExpired(o) && ["TRIAL", "LICENSE"].includes(o.plan);
export const daysLeft = (o: any) => (o?.expires_at ? Math.ceil((Date.parse(o.expires_at) - Date.now()) / 86400000) : 0);
export const tierLabel = (t?: string) => (t === "VIP" ? "VIP" : "Pro");
export const planLabel = (o: any) => (o?.plan === "LICENSE" ? (isExpired(o) ? "منتهي" : tierLabel(o.plan_tier)) : isExpired(o) ? "مجاني" : "Pro تجريبي");

// Feature modules the developer switches on per plan (must match convex/lib.ts MODULES).
export const MODULE_LABELS: Record<string, string> = {
  reports: "التقارير المتقدمة (أسبوعي/شهري)",
  targets: "أهداف المبيعات ولوحة المتصدرين",
  routes: "تخطيط مسارات الموزعين",
  tracking: "تتبع الموزعين المباشر",
  daily_sms: "ملخص SMS اليومي",
  debt_sms: "تذكير الديون التلقائي عبر SMS",
};
// Trial / older licences without a module list get every feature.
export const hasFeature = (o: any, key: string) => isPro(o) && (!Array.isArray(o?.modules) || o.modules.includes(key));

export function usePro() {
  const { user } = useAuth();
  const org = user?.org;
  const trial = org?.plan === "TRIAL";
  return { org, pro: isPro(org), trial: trial && !isExpired(org), free: trial && isExpired(org), daysLeft: daysLeft(org), isOwner: user?.role === "OWNER" };
}

// Login screen trial offer -> activation screen leads with the trial form.
export const TRIAL_INTENT_KEY = "trial_intent";
