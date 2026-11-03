import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { TextInput, useWindowDimensions, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/src/auth";
import { KeyboardScreen } from "@/src/components/KeyboardScreen";
import { DeviceConflictSheet } from "@/src/components/DeviceConflictSheet";
import { PasswordField, pwRules } from "@/src/components/PasswordField";
import { isValidCallingCode } from "@/src/phone";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { Badge, Btn, Field, Ionicons, T, toLatinDigits } from "@/src/ui";
import { storage } from "@/src/utils/storage";
import { TRIAL_INTENT_KEY } from "@/src/pro";

// Free Pro trial offer for new owners: tapping it remembers the intent (the activation screen then
// leads with the trial form) and focuses the phone field so sign-up starts right away.
function TrialOffer({ picked, onPick }: { picked: boolean; onPick: () => void }) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <View style={styles.trial} testID="login-trial-offer">
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        <View style={styles.diamond}>
          <Ionicons name="diamond-outline" size={16} color={colors.onBrandPrimary} />
        </View>
        <T v="label" style={{ flex: 1, fontSize: 16 }}>جرّب Pro مجاناً لمدة 14 يوماً</T>
        <Badge text="مجاناً" tone="pro" />
      </View>
      <T v="caption">للمالكين الجدد: كل ميزات Pro بدون بطاقة دفع. سجّل برقمك ثم أدخل اسم مؤسستك وابدأ فوراً.</T>
      {picked ? (
        <View testID="login-trial-picked" style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
          <Ionicons name="checkmark-circle" size={18} color={colors.success} />
          <T v="caption" color="success" style={{ flex: 1 }}>تم اختيار التجربة المجانية — أدخل رقمك بالأسفل للمتابعة</T>
        </View>
      ) : (
        <Btn testID="login-start-trial-button" small variant="secondary" icon="rocket-outline" title="ابدأ تجربتك المجانية" onPress={onPick} style={{ borderRadius: radius.md, borderWidth: 1, borderColor: colors.brandSecondary, minHeight: 44 }} />
      )}
    </View>
  );
}

const HERO =
  "https://images.unsplash.com/photo-1587293852726-70cdb56c2866?crop=entropy&cs=srgb&fm=jpg&q=85&w=1200";

export default function Login() {
  return <PhoneAuth />;
}

// Full-bleed warehouse photo behind the top of the screen, fading into the dark surface.
function HeroBackdrop() {
  const { height: winH } = useWindowDimensions();
  const { colors } = useTheme();
  return (
    <View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, height: winH * 0.62 }} testID="login-hero-bg">
      <Image source={{ uri: HERO }} style={StyleFill} contentFit="cover" />
      <LinearGradient colors={[colors.overlay, colors.overlay, colors.surface]} locations={[0, 0.55, 1]} style={StyleFill} />
    </View>
  );
}

function Hero() {
  const insets = useSafeAreaInsets();
  const styles = useStyles();
  return (
    <Animated.View entering={FadeInDown.duration(550)} style={{ paddingTop: insets.top + spacing.lg, paddingBottom: spacing.xl, alignItems: "center", gap: spacing.xs }} testID="login-hero">
      <View style={styles.logoRing}>
        <Image testID="login-hero-logo" source={require("../assets/images/icon.png")} style={{ width: 80, height: 80, borderRadius: radius.lg }} contentFit="cover" />
      </View>
      {/* Always white: it sits on the darkened photo in both themes. */}
      <T v="title" style={{ color: "#FFFFFF", fontSize: 30, lineHeight: 44, marginTop: spacing.sm }}>النظام الذكي</T>
      <T v="caption" style={{ color: "#E6E6E6" }}>نظام متكامل لإدارة المبيعات والتوزيع</T>
      <Features />
    </Animated.View>
  );
}

const StyleFill = { position: "absolute" as const, top: 0, left: 0, right: 0, bottom: 0 };

function Features() {
  const styles = useStyles();
  const { colors } = useTheme();
  const features: { icon: any; text: string }[] = [
    { icon: "cube-outline", text: "المخزون" },
    { icon: "receipt-outline", text: "الفواتير" },
    { icon: "people-outline", text: "الموزعون" },
  ];
  return (
    <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.md }} testID="login-features">
      {features.map((f) => (
        <View key={f.text} style={styles.fChip}>
          <Ionicons name={f.icon} size={14} color={colors.brandPrimary} />
          <T v="caption" style={{ color: colors.onSurface }} numberOfLines={1}>{f.text}</T>
        </View>
      ))}
    </View>
  );
}

const DEFAULT_CC = "+963";
const RESEND_SECONDS = 60;

// Phone → (password | SMS code → set password) → name (first login only).
// Each step: scrollable form + sticky footer (error + CTA).
function PhoneAuth() {
  const { user, busy, error, requestOtp, verifyOtp, startLogin, loginPassword, setPassword, saveName, logout } = useAuth();
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useStyles();
  const [cc, setCc] = useState(DEFAULT_CC);
  const [local, setLocal] = useState("");
  const [step, setStep] = useState<"phone" | "password" | "code">("phone");
  const [target, setTarget] = useState("");
  const [code, setCode] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [name, setName] = useState("");
  const [wait, setWait] = useState(0);
  const [resetting, setResetting] = useState(false);
  const [trialPicked, setTrialPicked] = useState(false);
  const phoneRef = useRef<any>(null);
  const pickTrial = () => {
    setTrialPicked(true);
    storage.setItem(TRIAL_INTENT_KEY, true);
    phoneRef.current?.focus();
  };

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait(wait - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const ccDigits = cc.replace(/\D/g, "");
  // Reject fake/unassigned country codes (e.g. "+123") up front so we never waste an SMS.
  const ccValid = isValidCallingCode(ccDigits);
  // Accept "0947…", "947…", "963947…" or "00963947…" in the local field.
  const localDigits = local.replace(/\D/g, "").replace(/^00/, "").replace(new RegExp(`^${ccDigits}(?=\\d{7,})`), "").replace(/^0+/, "");
  const phone = `+${ccDigits}${localDigits}`;
  const localValid = localDigits.length >= 6;

  const toCode = () => {
    setStep("code");
    setCode("");
    setWait(RESEND_SECONDS);
  };
  const next = async () => {
    if (!ccValid || !localValid || busy) return;
    const m = await startLogin(phone);
    if (!m) return;
    setTarget(phone);
    setPw("");
    if (m === "password") setStep("password");
    else toCode();
  };
  const resend = async () => {
    if (await requestOtp(target)) toCode();
  };
  const forgot = async () => {
    setResetting(true);
    if (await requestOtp(target)) toCode();
    else setResetting(false);
  };
  const back = () => {
    setStep("phone");
    setResetting(false);
  };

  const err = !!error && <T testID="login-error" color="error" style={{ textAlign: "center" }}>{error}</T>;
  const screen = (testID: string, body: React.ReactNode, footer: React.ReactNode) => (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <HeroBackdrop />
      <KeyboardScreen testID="login-screen" backgroundColor="transparent" footer={footer} contentContainerStyle={styles.body}>
        <Hero />
        <Animated.View entering={FadeInDown.delay(120).duration(500)} style={styles.panel} testID={testID}>{body}</Animated.View>
      </KeyboardScreen>
    </View>
  );

  // Signed in by SMS code without a password yet (or resetting it): choose one now.
  if (user && user.has_password === false) {
    const rules = pwRules(pw);
    const valid = rules.every((r) => r.ok) && pw === pw2;
    const submit = async () => {
      if (!valid) return;
      if (await setPassword(pw)) {
        setResetting(false);
        setPw("");
        setPw2("");
      }
    };
    return screen(
      "set-password-step",
      <>
        <T v="h2">عيّن كلمة المرور لحسابك</T>
        <T v="caption">في المرات القادمة ستدخل برقم هاتفك وكلمة المرور هذه بدون رمز SMS.</T>
        <PasswordField testID="login-new-password-input" label="كلمة المرور" value={pw} onChangeText={setPw} autoFocus />
        <PasswordField testID="login-confirm-password-input" label="تأكيد كلمة المرور" value={pw2} onChangeText={setPw2} onSubmitEditing={submit} />
        <View style={{ gap: spacing.xs }} testID="login-password-rules">
          {rules.map((r) => (
            <View key={r.text} style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
              <Ionicons name={r.ok ? "checkmark-circle" : "ellipse-outline"} size={16} color={r.ok ? colors.success : colors.muted} />
              <T v="caption" color={r.ok ? "success" : undefined}>{r.text}</T>
            </View>
          ))}
          {pw2.length > 0 && pw !== pw2 && <T testID="login-password-mismatch" v="caption" color="error">كلمتا المرور غير متطابقتين</T>}
        </View>
      </>,
      <>
        {err}
        <Btn testID="login-set-password-submit" title="حفظ كلمة المرور" icon="lock-closed-outline" loading={busy} disabled={!valid} onPress={submit} />
        <Btn testID="login-password-logout" variant="ghost" small title="تسجيل الخروج" onPress={logout} />
      </>,
    );
  }

  // Only owners/developers type their own name; an employee gets the name the owner put on the invite.
  if (user && !user.name && user.role && user.role !== "EMPLOYEE") {
    return screen(
      "name-step",
      <>
        <T v="h2">مرحباً بك! ما اسمك؟</T>
        <Field testID="login-name-input" label="الاسم الكامل" value={name} onChangeText={setName} placeholder="مثال: أحمد محمد" autoFocus returnKeyType="done" onSubmitEditing={() => saveName(name)} />
      </>,
      <>
        {err}
        <Btn testID="login-name-submit" title="متابعة" icon="arrow-back" loading={busy} disabled={name.trim().length < 2} onPress={() => saveName(name)} />
        <Btn testID="login-name-logout" variant="ghost" small title="تسجيل الخروج" onPress={logout} />
      </>,
    );
  }

  const phoneLabel = <T v="label" style={{ writingDirection: "ltr" }}>{target}</T>;

  if (step === "password") {
    return screen(
      "password-step",
      <>
        <T v="h2">أدخل كلمة المرور</T>
        <T v="caption">الدخول إلى الحساب {phoneLabel}</T>
        <PasswordField testID="login-password-input" label="كلمة المرور" value={pw} onChangeText={setPw} autoFocus onSubmitEditing={() => pw && loginPassword(target, pw)} />
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Btn testID="login-change-phone" variant="ghost" small title="تغيير الرقم" onPress={back} />
          <Btn testID="login-forgot-password" variant="ghost" small title="نسيت كلمة المرور؟" disabled={busy} onPress={forgot} />
        </View>
      </>,
      <>
        {err}
        <Btn testID="login-password-submit" title="دخول" icon="log-in-outline" loading={busy} disabled={!pw} onPress={() => loginPassword(target, pw)} />
        <DeviceConflictSheet />
      </>,
    );
  }

  if (step === "code") {
    return screen(
      "code-step",
      <>
        <T v="h2">{resetting ? "تأكيد استعادة الحساب" : "أدخل رمز التحقق"}</T>
        <View testID="login-sent-via" style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <Ionicons name="chatbubble-ellipses-outline" size={18} color={colors.brandPrimary} />
          <T v="caption" style={{ flex: 1 }}>أرسلنا رمزاً مكوناً من 6 أرقام عبر رسالة SMS إلى {phoneLabel}</T>
        </View>
        <Field
          testID="login-code-input"
          label="رمز التحقق"
          value={code}
          onChangeText={(t) => setCode(toLatinDigits(t).replace(/\D/g, "").slice(0, 6))}
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete="sms-otp"
          maxLength={6}
          autoFocus
          placeholder="••••••"
          style={{ textAlign: "center", letterSpacing: 8, fontSize: 22 }}
          onSubmitEditing={() => code.length === 6 && verifyOtp(target, code, false, resetting)}
        />
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Btn testID="login-change-phone" variant="ghost" small title="تغيير الرقم" onPress={back} />
          <Btn testID="login-resend-button" variant="ghost" small title={wait > 0 ? `إعادة الإرسال خلال ${wait} ث` : "إعادة إرسال الرمز"} disabled={wait > 0 || busy} onPress={resend} />
        </View>
      </>,
      <>
        {err}
        <Btn testID="login-verify-button" title="تحقق ومتابعة" icon="checkmark" loading={busy} disabled={code.length !== 6} onPress={() => verifyOtp(target, code, false, resetting)} />
        <DeviceConflictSheet />
      </>,
    );
  }

  return screen(
    "phone-step",
    <>
      <View style={{ gap: spacing.xs }}>
        <T v="h2">تسجيل الدخول</T>
        <T v="caption">أدخل رقم هاتفك للمتابعة، سنرسل لك رمز تحقق أو نطلب كلمة المرور.</T>
      </View>
      <View style={{ gap: spacing.sm }}>
        <T v="label" color="onSurfaceSecondary">رقم الهاتف</T>
        <View style={{ flexDirection: "row-reverse", gap: spacing.sm }}>
          <TextInput
            testID="login-country-code-input"
            value={cc}
            onChangeText={(t) => setCc("+" + toLatinDigits(t).replace(/\D/g, "").slice(0, 4))}
            keyboardType="phone-pad"
            style={[inputStyle(colors), { width: 84, textAlign: "center" }]}
          />
          <TextInput
            testID="login-phone-input"
            ref={phoneRef}
            value={local}
            onChangeText={(t) => setLocal(toLatinDigits(t).replace(/[^\d]/g, "").slice(0, 12))}
            keyboardType="phone-pad"
            textContentType="telephoneNumber"
            autoComplete="tel"
            placeholder="9XXXXXXXX"
            placeholderTextColor={colors.muted}
            returnKeyType="done"
            onSubmitEditing={next}
            style={[inputStyle(colors), { flex: 1, minWidth: 0, textAlign: "left", writingDirection: "ltr" }]}
          />
        </View>
        {ccDigits.length > 0 && !ccValid && (
          <T testID="login-cc-error" v="caption" color="error">رمز الدولة غير صحيح، تحقق منه قبل الإرسال</T>
        )}
      </View>
      <TrialOffer picked={trialPicked} onPick={pickTrial} />
    </>,
    <>
      {err}
      <Btn testID="login-continue-button" title="متابعة" icon="arrow-back" loading={busy} disabled={!ccValid || !localValid} onPress={next} />
      <T v="caption" style={{ textAlign: "center" }} testID="login-terms">
        بالمتابعة أنت توافق على{" "}
        <T v="caption" testID="login-terms-link" style={{ color: colors.info }} onPress={() => router.push("/legal" as any)}>شروط الاستخدام</T>
        {" "}و{" "}
        <T v="caption" testID="login-privacy-link" style={{ color: colors.info }} onPress={() => router.push("/legal" as any)}>سياسة الخصوصية</T>
      </T>
    </>,
  );
}

const inputStyle = (c: any) => ({
  minHeight: 52,
  borderRadius: radius.md,
  borderWidth: 1,
  borderColor: c.borderStrong,
  backgroundColor: c.surfaceTertiary,
  paddingHorizontal: spacing.md,
  fontFamily: fonts.regular,
  fontSize: 17,
  color: c.onSurface,
});

const useStyles = makeStyles((c) => ({
  logoRing: {
    padding: 3,
    borderRadius: radius.lg + 3,
    borderWidth: 1,
    borderColor: c.borderStrong,
    backgroundColor: c.brand,
    shadowColor: c.brand,
    shadowOpacity: 0.8,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  },
  body: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  panel: { gap: spacing.lg, padding: spacing.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: c.border, backgroundColor: c.surfaceSecondary },
  trial: { gap: spacing.md, padding: spacing.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: c.brandSecondary, backgroundColor: c.surfaceTertiary },
  diamond: { width: 30, height: 30, borderRadius: 15, backgroundColor: c.brandPrimary, alignItems: "center", justifyContent: "center" },
  fChip: { flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingVertical: spacing.xs, paddingHorizontal: spacing.md, borderRadius: radius.pill, backgroundColor: c.surfaceTertiary, borderWidth: 1, borderColor: c.borderStrong },
}));
