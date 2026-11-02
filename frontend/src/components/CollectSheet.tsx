import { useEffect, useState } from "react";
import { View } from "react-native";

import { money } from "@/src/api";
import { useAuth } from "@/src/auth";
import { offlineCollection } from "@/src/offlineActions";
import { useExchangeRate } from "@/src/pricing";
import { spacing } from "@/src/theme";
import { Btn, Card, Field, Segments, Sheet, T, useToast } from "@/src/ui";

export function CollectSheet({ customer, onClose }: { customer: any | null; onClose: () => void }) {
  const toast = useToast();
  const { user } = useAuth();
  const rate = useExchangeRate();
  const [amount, setAmount] = useState("");
  const [cur, setCur] = useState<"SYP" | "USD">("SYP");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (customer) {
      setAmount(String(customer.balance));
      setCur("SYP");
      setNotes("");
    }
  }, [customer]);
  const base = cur === "USD" && rate > 0 ? Math.round(+amount * rate * 100) / 100 : +amount || 0;
  const submit = async () => {
    if (!(+amount > 0)) return toast("أدخل مبلغاً صحيحاً", "error");
    if (base > customer.balance + 0.001) return toast("المبلغ أكبر من دين العميل", "error");
    setSaving(true);
    try {
      await offlineCollection({ customer, amount: +amount, notes, userName: user?.name, currency: cur, rate });
      toast("تم تسجيل التحصيل");
      onClose();
    } finally {
      setSaving(false);
    }
  };
  return (
    <Sheet
      testID="collect-sheet"
      visible={!!customer}
      onClose={onClose}
      title="تحصيل دفعة"
      footer={<Btn testID="confirm-collection-button" title="تأكيد التحصيل" icon="cash-outline" onPress={submit} loading={saving} />}
    >
      {customer && (
        <>
          <Card>
            <T v="h2">{customer.name}</T>
            <T color="warning">الدين الحالي: {money(customer.balance)} ل.س</T>
          </Card>
          {rate > 0 && (
            <View style={{ marginHorizontal: -spacing.lg }}>
              <Segments value={cur} onChange={(k) => setCur(k)} options={[{ key: "SYP", label: "ليرة سورية" }, { key: "USD", label: "دولار $" }]} />
            </View>
          )}
          <Field testID="collection-amount-input" label={`المبلغ المحصّل (${cur === "USD" ? "$" : "ل.س"})`} keyboardType="decimal-pad" value={amount} onChangeText={setAmount} />
          {cur === "USD" && rate > 0 && <T v="caption" testID="collection-converted">≈ {money(base)} ل.س (سعر الصرف {money(rate)})</T>}
          <Field testID="collection-notes-input" label="ملاحظات" value={notes} onChangeText={setNotes} />
        </>
      )}
    </Sheet>
  );
}
