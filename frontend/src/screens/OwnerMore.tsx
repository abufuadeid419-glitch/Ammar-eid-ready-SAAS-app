import { useEffect, useRef, useState } from "react";
import { Linking, Platform, RefreshControl, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import * as Clipboard from "expo-clipboard";
import * as Sharing from "expo-sharing";
import QRCode from "react-native-qrcode-svg";
import { captureRef } from "react-native-view-shot";

import { useLocalSearchParams, useRouter } from "expo-router";
import { fmtDate } from "@/src/api";
import { useAuth } from "@/src/auth";
import { AccountButton } from "@/src/components/AccountButton";
import { AgentsMap } from "@/src/components/AgentsMap";
import { OrgProfile } from "@/src/components/OrgProfile";
import { OrgSettings } from "@/src/components/OrgSettings";
import { PriceLists } from "@/src/components/PriceLists";
import { ProUpsell } from "@/src/components/ProUpsell";
import { RoutePlanner } from "@/src/components/RoutePlanner";
import { OwnerStockRequests } from "@/src/components/StockRequests";
import { OwnerWarehouseReturns } from "@/src/components/WarehouseReturns";
import { Unit, UnitToggle, piecesOf, qtyLabel, unitName } from "@/src/components/UnitToggle";
import { useApi, useBottomChrome, useMutate } from "@/src/hooks";
import { ProLock } from "@/src/components/ProLock";
import { spacing, useTheme } from "@/src/theme";
import { Badge, Btn, Card, Empty, Field, Header, IconBtn, Loading, Row, Section, Segments, Select, Sheet, T, useToast } from "@/src/ui";

function InviteSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [type, setType] = useState<"FIELD_AGENT" | "ACCOUNTANT">("FIELD_AGENT");
  const [code, setCode] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const shareRef = useRef<View>(null);
  const m = useMutate("POST", "/employees/invite", "تم إنشاء رمز الدعوة", (r) => setCode(r.code));
  const close = () => { setCode(null); setName(""); onClose(); };

  const shareInvite = async () => {
    if (!code) return;
    const text = `دعوة للانضمام إلى فريق "النظام الذكي".\nرمز التفعيل: ${code}\nافتح التطبيق وسجّل الدخول، ثم امسح رمز QR أو أدخل الرمز يدوياً.`;
    if (Platform.OS === "web") { Linking.openURL(`https://wa.me/?text=${encodeURIComponent(text)}`); return; }
    try {
      setSharing(true);
      const uri = await captureRef(shareRef, { format: "png", quality: 1 });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: "image/png", dialogTitle: "مشاركة دعوة الموظف عبر واتساب" });
      } else {
        await Linking.openURL(`whatsapp://send?text=${encodeURIComponent(text)}`).catch(() => toast("واتساب غير مثبّت", "error"));
      }
    } catch {
      toast("تعذّر المشاركة، حاول مرة أخرى", "error");
    } finally {
      setSharing(false);
    }
  };

  return (
    <Sheet testID="invite-sheet" visible={visible} onClose={close} title="إضافة موظف"
      footer={code ? <Btn testID="invite-done-button" title="تم" onPress={close} /> : <Btn testID="create-invite-button" title="إنشاء رمز التفعيل" icon="key-outline" loading={m.isPending} onPress={() => (name.trim() ? m.mutate({ name, employee_type: type }) : toast("أدخل اسم الموظف", "error"))} />}>
      {code ? (
        <Card style={{ gap: spacing.md }}>
          <T v="caption" style={{ textAlign: "center" }}>شارك الدعوة مع الموظف عبر واتساب، أو اطلب منه مسح رمز QR من شاشة التفعيل، أو أرسل له الرمز لإدخاله يدوياً.</T>
          <View ref={shareRef} collapsable={false} style={{ backgroundColor: "#ffffff", borderRadius: 16, padding: spacing.lg, alignItems: "center", gap: spacing.sm }}>
            <T v="label" style={{ color: "#0f5132" }}>النظام الذكي — دعوة موظف</T>
            <View style={{ backgroundColor: "#ffffff", padding: spacing.sm }} testID="invite-qr">
              <QRCode value={code} size={200} backgroundColor="#ffffff" color="#111111" />
            </View>
            <T v="h2" style={{ color: "#111111" }} selectable testID="invite-code-text">{code}</T>
            <T v="caption" style={{ color: "#555555", textAlign: "center" }}>سجّل الدخول ثم امسح الرمز أو أدخله يدوياً</T>
          </View>
          <Btn testID="share-invite-whatsapp" icon="logo-whatsapp" title="مشاركة عبر واتساب" loading={sharing} onPress={shareInvite} />
          <Btn testID="copy-invite-code" variant="secondary" small icon="copy-outline" title="نسخ الرمز" onPress={async () => { await Clipboard.setStringAsync(code); toast("تم نسخ الرمز"); }} />
        </Card>
      ) : (
        <>
          <Field testID="invite-name-input" label="اسم الموظف" value={name} onChangeText={setName} />
          <T v="label" color="onSurfaceSecondary">نوع الحساب</T>
          <View style={{ marginHorizontal: -spacing.lg }}>
            <Segments value={type} onChange={setType} options={[{ key: "FIELD_AGENT", label: "موزع ميداني" }, { key: "ACCOUNTANT", label: "محاسب" }]} />
          </View>
        </>
      )}
    </Sheet>
  );
}

function DeliverySheet({ visible, onClose, agents }: { visible: boolean; onClose: () => void; agents: any[] }) {
  const toast = useToast();
  const products = useApi<any[]>("/products", visible);
  const [agent, setAgent] = useState<any>(null);
  const [lines, setLines] = useState<{ product: any; qty: string; unit: Unit }[]>([]);
  const m = useMutate("POST", "/deliveries", "تم تسليم البضاعة للموزع", () => { setLines([]); setAgent(null); onClose(); });
  const submit = () => {
    if (!agent || !lines.length || lines.some((l) => !(+l.qty > 0))) return toast("اختر الموزع وأدخل الكميات", "error");
    const over = lines.find((l) => piecesOf(l.product, l.unit, +l.qty) > (l.product.stock ?? 0));
    if (over) return toast(`الكمية غير متوفرة في المستودع: ${over.product.name}`, "error");
    m.mutate({ distributor_id: agent.user_id, items: lines.map((l) => ({ product_id: l.product.id, quantity: +l.qty, unit: l.unit })) });
  };
  return (
    <Sheet testID="delivery-sheet" visible={visible} onClose={onClose} title="تسليم بضاعة لموزع" footer={<Btn testID="save-delivery-button" title="تأكيد التسليم" icon="car-outline" onPress={submit} loading={m.isPending} />}>
      <Select testID="delivery-agent-select" label="الموزع" placeholder="اختر الموزع" value={agent?.name ?? null} options={agents} getLabel={(a: any) => a.name ?? a.email} onSelect={setAgent} />
      {lines.map((l, i) => (
        <View key={l.product.id} style={{ gap: spacing.sm }}>
          <UnitToggle testID={`delivery-unit-${i}`} product={l.product} value={l.unit} onChange={(u) => setLines(lines.map((x, j) => (j === i ? { ...x, unit: u } : x)))} />
          <View style={{ flexDirection: "row", alignItems: "flex-end", gap: spacing.sm }}>
            <View style={{ flex: 1 }}>
              <Field testID={`delivery-qty-input-${i}`} label={`${l.product.name} · ${unitName(l.product, l.unit)} (المستودع: ${l.product.stock} ${unitName(l.product, "PIECE")})`} keyboardType="decimal-pad" value={l.qty} onChangeText={(v) => setLines(lines.map((x, j) => (j === i ? { ...x, qty: v } : x)))} />
            </View>
            <IconBtn testID={`delivery-remove-${i}`} icon="trash-outline" onPress={() => setLines(lines.filter((_, j) => j !== i))} />
          </View>
        </View>
      ))}
      <Select testID="delivery-product-select" label="إضافة منتج" placeholder="+ اختر منتجاً" value={null} options={(products.data ?? []).filter((p) => p.stock > 0 && !lines.find((l) => l.product.id === p.id))} getLabel={(p: any) => p.name} getSub={(p: any) => `المستودع: ${p.stock}`} onSelect={(p) => setLines([...lines, { product: p, qty: "", unit: "PIECE" }])} />
    </Sheet>
  );
}

export default function OwnerMore() {
  const { colors } = useTheme();
  const { user } = useAuth();
  const router = useRouter();
  const bottom = useBottomChrome();
  const [tab, setTab] = useState<"team" | "deliveries" | "routes" | "prices" | "tracking" | "profile">("team");
  const tracking = useApi<any[]>("/tracking/agents", tab === "tracking", 60000);
  const emps = useApi<any>("/employees");
  const deliveries = useApi<any[]>("/deliveries");
  const [invite, setInvite] = useState(false);
  const [deliver, setDeliver] = useState(false);

  // Deep link from the owner onboarding guide: jump to the team tab and open the invite sheet.
  const params = useLocalSearchParams<{ invite?: string }>();
  useEffect(() => {
    if (params.invite === "1") {
      setTab("team");
      setInvite(true);
    }
  }, [params.invite]);

  const delInvite = useMutate<any>("DELETE", (b) => `/employees/invite/${b.id}`, "تم حذف الدعوة");
  const removeEmp = useMutate<any>("DELETE", (b) => `/employees/${b.user_id}`, "تمت إزالة الموظف");
  const agents = (emps.data?.employees ?? []).filter((e: any) => e.employee_type === "FIELD_AGENT");

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }} testID="owner-more-screen">
      <Header title="الإدارة" subtitle={`${user?.org?.name ?? ""} · حتى ${user?.org?.max_employees ?? 0} موظفين`} right={<AccountButton />} />
      <Segments value={tab} onChange={setTab} options={[{ key: "team", label: "الموظفون" }, { key: "deliveries", label: "التسليم والمرتجعات" }, { key: "routes", label: "خطوط السير" }, { key: "prices", label: "أسعار العملاء" }, { key: "tracking", label: "تتبع GPS" }, { key: "profile", label: "ملف المؤسسة" }]} />
      <KeyboardAwareScrollView
        bottomOffset={24}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.xl, paddingBottom: bottom + spacing.xl }}
        refreshControl={<RefreshControl refreshing={emps.isRefetching || deliveries.isRefetching} onRefresh={() => { emps.refetch(); deliveries.refetch(); tracking.refetch(); }} tintColor={colors.brandPrimary} />}
      >
        {tab === "routes" ? (
          <ProLock testID="lock-routes" module="routes" feature="تخطيط مسارات الموزعين">
            <RoutePlanner agents={agents} />
          </ProLock>
        ) : tab === "prices" ? (
          <PriceLists />
        ) : tab === "profile" ? (
          <>
            <OrgProfile />
            <OrgSettings />
          </>
        ) : tab === "tracking" ? (
          tracking.isLoading ? <Loading /> : (
            <ProLock testID="lock-tracking" module="tracking" feature="تتبع الموزعين المباشر">
              <Btn testID="open-agents-map-button" icon="map-outline" title="الخريطة الحية" onPress={() => router.push("/agents-map" as any)} />
              <AgentsMap agents={tracking.data ?? []} />
            </ProLock>
          )
        ) : tab === "team" ? (
          <>
            <Btn testID="open-invite-button" title="إضافة موظف جديد" icon="person-add-outline" onPress={() => setInvite(true)} />
            <ProUpsell testID="team-pro-upsell" reason={`الخطة التجريبية تسمح بـ ${user?.org?.max_employees ?? 3} موظفين فقط. قم بالترقية لإضافة المزيد من الموزعين.`} />
            <Section title="الموظفون">
              <Card style={{ padding: 0, overflow: "hidden" }}>
                {!emps.data?.employees?.length ? <Empty icon="people-outline" text="لا يوجد موظفون مفعّلون" /> : emps.data.employees.map((e: any) => (
                  <Row key={e.user_id} testID={`employee-row-${e.user_id}`} icon={e.employee_type === "ACCOUNTANT" ? "calculator-outline" : "car-outline"} title={e.name ?? e.email} subtitle={`${e.employee_type === "ACCOUNTANT" ? "محاسب" : "موزع ميداني"} · ${e.email}`}
                    right={<IconBtn testID={`remove-employee-${e.user_id}`} icon="person-remove-outline" onPress={() => removeEmp.mutate(e)} />} />
                ))}
              </Card>
            </Section>
            <Section title="دعوات بانتظار التفعيل">
              <Card style={{ padding: 0, overflow: "hidden" }}>
                {!emps.data?.invitations?.length ? <Empty icon="mail-outline" text="لا توجد دعوات معلّقة" /> : emps.data.invitations.map((i: any) => (
                  <Row key={i.id} testID={`invite-row-${i.id}`} icon="key-outline" title={i.name} subtitle={i.code}
                    right={<IconBtn testID={`delete-invite-${i.id}`} icon="trash-outline" onPress={() => delInvite.mutate(i)} />} />
                ))}
              </Card>
            </Section>
          </>
        ) : (
          <>
            <OwnerStockRequests />
            <OwnerWarehouseReturns />
            <Btn testID="open-delivery-button" title="تسليم بضاعة لموزع" icon="car-outline" onPress={() => setDeliver(true)} disabled={!agents.length} />
            {!agents.length && <T v="caption" style={{ textAlign: "center" }}>أضف موزعاً ميدانياً أولاً من تبويب الموظفين</T>}
            <Section title="سجل التسليمات">
              <Card style={{ padding: 0, overflow: "hidden" }}>
                {!deliveries.data?.length ? <Empty icon="car-outline" text="لا توجد تسليمات" /> : deliveries.data.map((d) => (
                  <Row key={d.id} testID={`delivery-row-${d.id}`} icon="car-outline" title={d.distributor_name ?? "موزع"} subtitle={`${d.items.map((x: any) => `${x.product_name} ×${qtyLabel(x)}`).join("، ")} · ${fmtDate(d.created_at)}`} right={<Badge text={`${d.items.length} صنف`} />} />
                ))}
              </Card>
            </Section>
          </>
        )}
      </KeyboardAwareScrollView>
      <InviteSheet visible={invite} onClose={() => setInvite(false)} />
      <DeliverySheet visible={deliver} onClose={() => setDeliver(false)} agents={agents} />
    </View>
  );
}

