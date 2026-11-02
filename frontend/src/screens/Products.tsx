import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { FlatList, RefreshControl, View } from "react-native";

import { api, money } from "@/src/api";
import { useAuth } from "@/src/auth";
import { PricingMethodSheet } from "@/src/components/PricingMethod";
import { StockLog } from "@/src/components/StockLog";
import { SupplierStatementsSheet } from "@/src/components/SupplierStatements";
import { Unit, UnitToggle, piecesOf, pppOf, unitName } from "@/src/components/UnitToggle";
import { useApi, useBottomChrome, useMutate } from "@/src/hooks";
import { queryClient } from "@/src/query-client";
import { spacing, useTheme } from "@/src/theme";
import { Badge, Btn, Empty, ErrorBox, Field, Header, IconBtn, Loading, Row, Segments, Select, Sheet, T, useToast } from "@/src/ui";

const blank = { name: "", category: "", unit: "قطعة", package_unit: "كرتونة", pieces_per_package: "1", price_currency: "SYP", cost_price: "", sale_price: "", package_price: "", stock: "", min_stock: "" };

// "3 كرتونة + 5 قطعة" when a package holds many pieces, else just pieces.
const stockLabel = (p: any) => {
  const ppp = Math.max(1, Math.round(p.pieces_per_package ?? 1));
  const stock = Math.round(p.stock ?? 0);
  const pieceU = p.unit || "قطعة";
  if (ppp <= 1) return `${money(stock)} ${pieceU}`;
  const packs = Math.floor(stock / ppp);
  const rem = stock - packs * ppp;
  const packU = p.package_unit || "كرتونة";
  return [packs > 0 ? `${packs} ${packU}` : "", rem > 0 ? `${rem} ${pieceU}` : ""].filter(Boolean).join(" + ") || `0 ${pieceU}`;
};

export default function Products() {
  const { colors } = useTheme();
  const bottom = useBottomChrome();
  const toast = useToast();
  const [tab, setTab] = useState<"products" | "purchases" | "returns" | "movements">("products");
  const [suppliers, setSuppliers] = useState(false);
  const products = useApi<any[]>("/products");
  const purchases = useApi<any[]>("/purchases");
  const suppliersQ = useApi<any[]>("/suppliers");
  // Saved supplier contacts + every supplier name used in previous purchases.
  const supplierNames = [...new Set([...(suppliersQ.data ?? []).map((x) => x.name), ...(purchases.data ?? []).map((p) => (p.supplier ?? "").trim())].filter(Boolean))] as string[];
  const [edit, setEdit] = useState<any | null>(null);
  const [form, setForm] = useState<any>(blank);
  const [buy, setBuy] = useState<any | null>(null);

  const save = useMutate("POST", "/products", "تم حفظ المنتج", () => setEdit(null));
  const update = useMutate<any>("PUT", (b) => `/products/${b.id}`, "تم تحديث المنتج", () => setEdit(null));
  const del = useMutate<any>("DELETE", (b) => `/products/${b.id}`, "تم حذف المنتج", () => setEdit(null));
  const purchase = { isPending: false };
  const { user } = useAuth();

  // Deep link from the owner onboarding guide: open the "new product" sheet automatically.
  const params = useLocalSearchParams<{ new?: string }>();
  useEffect(() => {
    if (params.new === "1") {
      setForm(blank);
      setEdit({});
    }
  }, [params.new]);

  const open = (p?: any) => {
    const ppp = Math.max(1, Math.round(p?.pieces_per_package ?? 1));
    setForm(
      p
        ? {
            ...p,
            unit: p.unit ?? "قطعة",
            package_unit: p.package_unit ?? "كرتونة",
            pieces_per_package: String(ppp),
            price_currency: p.price_currency === "USD" ? "USD" : "SYP",
            cost_price: String(p.cost_price ?? ""),
            sale_price: String(p.sale_price ?? ""),
            package_price: String(Math.round((p.sale_price ?? 0) * ppp * 100) / 100),
            stock: String(p.stock ?? ""),
            min_stock: String(p.min_stock ?? ""),
          }
        : blank,
    );
    setEdit(p ?? {});
  };
  const submit = () => {
    if (!form.name.trim()) return toast("اسم المنتج مطلوب", "error");
    const body = {
      name: form.name,
      category: form.category,
      unit: form.unit || "قطعة",
      package_unit: form.package_unit || "كرتونة",
      price_currency: form.price_currency === "USD" ? "USD" : "SYP",
      pieces_per_package: Math.max(1, Math.round(+form.pieces_per_package || 1)),
      cost_price: +form.cost_price || 0,
      sale_price: +form.sale_price || 0,
      stock: +form.stock || 0,
      min_stock: +form.min_stock || 0,
    };
    if (edit?.id) update.mutate({ ...body, id: edit.id });
    else save.mutate(body);
  };
  const [buying, setBuying] = useState(false);
  const [askPricing, setAskPricing] = useState(false);
  const buyProd = products.data?.find((p) => p.id === buy?.product_id);
  const submitBuy = async () => {
    if (!buy.product_id || !(+buy.quantity > 0)) return toast("اختر المنتج وأدخل الكمية", "error");
    setBuying(true);
    try {
      await api("/purchases", { method: "POST", body: { product_id: buy.product_id, quantity: +buy.quantity, unit: buy.unit, unit_cost: +buy.unit_cost || 0, supplier: buy.supplier } });
      queryClient.invalidateQueries();
      toast("تمت إضافة الكمية للمستودع");
      setBuy(null);
    } catch (e: any) {
      if (String(e?.message).includes("PRICING_METHOD_REQUIRED")) setAskPricing(true);
      else toast(e.message, "error");
    } finally {
      setBuying(false);
    }
  };
  const pickBuyProduct = (p: any) => setBuy({ ...buy, product_id: p.id, unit: "PIECE", unit_cost: String(p.cost_price ?? "") });
  const setBuyUnit = (u: Unit) => {
    if (!buyProd || u === buy.unit) return;
    const c = +buy.unit_cost || 0;
    const k = pppOf(buyProd);
    setBuy({ ...buy, unit: u, unit_cost: String(Math.round((u === "PACKAGE" ? c * k : c / k) * 100) / 100) });
  };
  const set = (k: string) => (v: string) => setForm((f: any) => ({ ...f, [k]: v }));
  const ppp = Math.max(1, Math.round(+form.pieces_per_package || 1));
  const curSym = form.price_currency === "USD" ? "$" : "ل.س";
  const setPiece = (v: string) => setForm((f: any) => ({ ...f, sale_price: v, package_price: v === "" ? "" : String(Math.round((+v || 0) * ppp * 100) / 100) }));
  const setPackage = (v: string) => setForm((f: any) => ({ ...f, package_price: v, sale_price: v === "" ? "" : String(Math.round(((+v || 0) / ppp) * 100) / 100) }));
  const setPpp = (v: string) =>
    setForm((f: any) => {
      const n = Math.max(1, Math.round(+v || 1));
      return { ...f, pieces_per_package: v, package_price: f.sale_price === "" ? "" : String(Math.round((+f.sale_price || 0) * n * 100) / 100) };
    });
  const q = tab === "products" ? products : purchases;

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }} testID="products-screen">
      <Header
        title="المخزون"
        subtitle="المنتجات والمستودع"
        right={
          <>
            <IconBtn testID="supplier-statements-button" icon="storefront-outline" onPress={() => setSuppliers(true)} />
            <IconBtn testID="add-purchase-button" icon="download-outline" onPress={() => setBuy({ product_id: null, quantity: "", unit: "PIECE", unit_cost: "", supplier: "" })} />
            <IconBtn testID="add-product-button" icon="add" tone="brand" onPress={() => open()} />
          </>
        }
      />
      <Segments value={tab} onChange={setTab} options={[{ key: "products", label: "المنتجات" }, { key: "purchases", label: "المشتريات" }, { key: "returns", label: "مرتجع المشتريات" }, { key: "movements", label: "حركة المخزون" }]} />
      {tab === "returns" || tab === "movements" ? (
        <StockLog tab={tab} products={products.data ?? []} />
      ) : q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox message={(q.error as Error).message} onRetry={q.refetch} />
      ) : (
        <FlatList
          data={q.data as any[]}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ paddingBottom: bottom + spacing.xl }}
          refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={q.refetch} tintColor={colors.brandPrimary} />}
          ListEmptyComponent={
            tab === "products" ? (
              <Empty icon="cube-outline" text="لا توجد منتجات بعد" action={<Btn small testID="empty-add-product-button" title="إضافة منتج" icon="add" onPress={() => open()} />} />
            ) : (
              <Empty icon="cart-outline" text="لا توجد مشتريات بعد" />
            )
          }
          renderItem={({ item }) =>
            tab === "products" ? (
              <Row
                testID={`product-row-${item.id}`}
                icon="cube-outline"
                title={item.name}
                subtitle={`بيع ${money(item.sale_price)} ${item.price_currency === "USD" ? "$" : "ل.س"}/${item.unit || "قطعة"}${item.pieces_per_package > 1 ? ` · ${money((item.sale_price || 0) * item.pieces_per_package)} ${item.price_currency === "USD" ? "$" : "ل.س"}/${item.package_unit || "كرتونة"}` : ""}${item.category ? " · " + item.category : ""}`}
                onPress={() => open(item)}
                right={<Badge text={stockLabel(item)} tone={item.stock <= item.min_stock ? "warning" : "brand"} />}
              />
            ) : (
              <Row icon="download-outline" title={`${item.product_name} × ${money(item.quantity)}`} subtitle={`${item.supplier || "بدون مورد"} · ${new Date(item.created_at).toLocaleDateString("en-GB")}`} right={<T v="label">{money(item.total)}</T>} />
            )
          }
        />
      )}

      <Sheet
        testID="product-form-sheet"
        visible={!!edit}
        onClose={() => setEdit(null)}
        title={edit?.id ? "تعديل منتج" : "منتج جديد"}
        footer={
          <>
            <Btn testID="save-product-button" title="حفظ" icon="checkmark" onPress={submit} loading={save.isPending || update.isPending} />
            {edit?.id && <Btn testID="delete-product-button" variant="ghost" title="حذف المنتج" onPress={() => del.mutate({ id: edit.id })} loading={del.isPending} />}
          </>
        }
      >
        <Field testID="product-name-input" label="اسم المنتج" value={form.name} onChangeText={set("name")} />
        <View style={{ flexDirection: "row", gap: spacing.md }}>
          <View style={{ flex: 1 }}><Field testID="product-category-input" label="التصنيف" value={form.category} onChangeText={set("category")} /></View>
          <View style={{ flex: 1 }}><Field testID="product-unit-input" label="وحدة القطعة" value={form.unit} onChangeText={set("unit")} /></View>
        </View>
        <View style={{ flexDirection: "row", gap: spacing.md }}>
          <View style={{ flex: 1 }}><Field testID="product-package-unit-input" label="وحدة التعبئة" value={form.package_unit} onChangeText={set("package_unit")} placeholder="كرتونة" /></View>
          <View style={{ flex: 1 }}><Field testID="product-ppp-input" label="عدد القطع بالكرتونة" keyboardType="number-pad" value={form.pieces_per_package} onChangeText={setPpp} /></View>
        </View>
        <View style={{ gap: spacing.xs }}>
          <T v="label" color="onSurfaceSecondary">عملة التسعير</T>
          <View style={{ marginHorizontal: -spacing.lg }}>
            <Segments value={form.price_currency} onChange={(k) => setForm((f: any) => ({ ...f, price_currency: k }))} options={[{ key: "SYP", label: "ليرة سورية" }, { key: "USD", label: "دولار $" }]} />
          </View>
        </View>
        <View style={{ flexDirection: "row", gap: spacing.md }}>
          <View style={{ flex: 1 }}><Field testID="product-price-input" label={`سعر القطعة (${curSym})`} keyboardType="decimal-pad" value={form.sale_price} onChangeText={setPiece} /></View>
          <View style={{ flex: 1 }}><Field testID="product-package-price-input" label={`سعر الكرتونة (${curSym})`} keyboardType="decimal-pad" value={form.package_price} onChangeText={setPackage} /></View>
        </View>
        <Field testID="product-cost-input" label={`سعر تكلفة القطعة (${curSym})`} keyboardType="decimal-pad" value={form.cost_price} onChangeText={set("cost_price")} />
        <View style={{ flexDirection: "row", gap: spacing.md }}>
          <View style={{ flex: 1 }}><Field testID="product-stock-input" label="الكمية بالمستودع (قطعة)" keyboardType="decimal-pad" value={form.stock} onChangeText={set("stock")} /></View>
          <View style={{ flex: 1 }}><Field testID="product-min-stock-input" label="حد التنبيه (قطعة)" keyboardType="decimal-pad" value={form.min_stock} onChangeText={set("min_stock")} /></View>
        </View>
        {ppp > 1 && +form.stock > 0 && <T v="caption" testID="product-stock-hint">= {stockLabel({ ...form, stock: +form.stock, pieces_per_package: ppp })}</T>}
        {Array.isArray(edit?.cost_layers) && edit.cost_layers.length > 1 && (
          <View style={{ gap: spacing.xs }} testID="product-fifo-layers">
            <T v="label">دفعات المخزون (الوارد أولاً صادر أولاً)</T>
            {edit.cost_layers.map((l: any, i: number) => (
              <T key={i} v="caption">{i === 0 ? "• الحالية" : `• دفعة ${i + 1}`}: {money(l.qty)} قطعة · تكلفة {money(l.cost)} · بيع {money(l.price)}</T>
            ))}
          </View>
        )}
      </Sheet>

      <Sheet
        testID="purchase-form-sheet"
        visible={!!buy}
        onClose={() => setBuy(null)}
        title="إضافة مشتريات للمستودع"
        footer={<Btn testID="save-purchase-button" title="حفظ المشتريات" icon="checkmark" onPress={submitBuy} loading={buying} />}
      >
        {buy && (
          <>
            <Select
              testID="purchase-product-select"
              label="المنتج"
              placeholder="اختر المنتج"
              value={buyProd?.name ?? null}
              options={products.data ?? []}
              getLabel={(p: any) => p.name}
              getSub={(p: any) => `المخزون: ${stockLabel(p)}`}
              onSelect={pickBuyProduct}
            />
            {buyProd && <UnitToggle testID="purchase-unit" product={buyProd} value={buy.unit} onChange={setBuyUnit} />}
            <View style={{ flexDirection: "row", gap: spacing.md }}>
              <View style={{ flex: 1 }}><Field testID="purchase-qty-input" label={`الكمية (${unitName(buyProd, buy.unit)})`} keyboardType="decimal-pad" value={buy.quantity} onChangeText={(v) => setBuy({ ...buy, quantity: v })} /></View>
              <View style={{ flex: 1 }}><Field testID="purchase-cost-input" label={`تكلفة ${unitName(buyProd, buy.unit)}`} keyboardType="decimal-pad" value={buy.unit_cost} onChangeText={(v) => setBuy({ ...buy, unit_cost: v })} /></View>
            </View>
            {buyProd && buy.unit === "PACKAGE" && +buy.quantity > 0 && <T v="caption" testID="purchase-pieces-hint">= {money(piecesOf(buyProd, "PACKAGE", +buy.quantity))} {unitName(buyProd, "PIECE")} تُضاف للمستودع</T>}
            {buyProd && +buy.unit_cost > 0 && Math.abs((+buy.unit_cost / (buy.unit === "PACKAGE" ? pppOf(buyProd) : 1)) - (buyProd.cost_price ?? 0)) > 0.001 && (
              <T v="caption" color="warning" testID="purchase-cost-change-hint">
                التكلفة تختلف عن الحالية ({money(buyProd.cost_price)}) · سياسة التسعير: {user?.org?.pricing_method === "FIFO" ? "الوارد أولاً صادر أولاً" : user?.org?.pricing_method === "WAVG" ? "المتوسط المرجّح" : user?.org?.pricing_method === "LATEST" ? "اعتماد السعر الجديد على كل البضاعة" : "سيُطلب منك اختيارها"}
              </T>
            )}
            <Select
              testID="purchase-supplier-select"
              label="المورد"
              placeholder={supplierNames.length ? "اختر مورداً محفوظاً" : "لا يوجد موردون محفوظون بعد"}
              value={supplierNames.includes(buy.supplier) ? buy.supplier : null}
              options={supplierNames}
              getLabel={(n: string) => n}
              getSub={(n: string) => suppliersQ.data?.find((x) => x.name === n)?.phone || ""}
              onSelect={(n: string) => setBuy({ ...buy, supplier: n })}
            />
            <Field testID="purchase-supplier-input" label="أو اكتب اسم مورد جديد" value={buy.supplier} onChangeText={(v) => setBuy({ ...buy, supplier: v })} />
          </>
        )}
      </Sheet>
      <PricingMethodSheet visible={askPricing} onClose={() => setAskPricing(false)} onSaved={() => { setAskPricing(false); submitBuy(); }} />
      <SupplierStatementsSheet visible={suppliers} onClose={() => setSuppliers(false)} />
    </View>
  );
}

