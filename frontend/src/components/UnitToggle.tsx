import { Pressable, View } from "react-native";

import { money } from "@/src/api";
import { radius, spacing, useTheme } from "@/src/theme";
import { T } from "@/src/ui";

export type Unit = "PIECE" | "PACKAGE";

export const pppOf = (p: any) => Math.max(1, Math.round(p?.pieces_per_package ?? 1));
export const unitName = (p: any, u: Unit) => (u === "PACKAGE" ? p?.package_unit || "كرتونة" : p?.unit || "قطعة");
export const piecesOf = (p: any, u: Unit, qty: number) => qty * (u === "PACKAGE" ? pppOf(p) : 1);
// "2 كرتونة" / "5 قطعة" for any stored document line (old lines without a unit fall back to pieces).
export const qtyLabel = (it: any) => `${money(it.quantity)} ${it.unit_label || (it.unit === "PACKAGE" ? "كرتونة" : "قطعة")}`;

// Piece / package switch shown on every document line (hidden when the product has no package).
export function UnitToggle({ product, value, onChange, testID }: { product: any; value: Unit; onChange: (u: Unit) => void; testID: string }) {
  const { colors } = useTheme();
  const ppp = pppOf(product);
  if (ppp <= 1) return null;
  const opts: { key: Unit; label: string }[] = [
    { key: "PIECE", label: unitName(product, "PIECE") },
    { key: "PACKAGE", label: `${unitName(product, "PACKAGE")} (${ppp})` },
  ];
  return (
    <View style={{ flexDirection: "row", gap: spacing.sm }} testID={testID}>
      {opts.map((o) => {
        const sel = o.key === value;
        return (
          <Pressable
            key={o.key}
            testID={`${testID}-${o.key.toLowerCase()}`}
            onPress={() => onChange(o.key)}
            style={{ flex: 1, height: 36, borderRadius: radius.pill ?? 18, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: sel ? colors.brandPrimary : colors.border, backgroundColor: sel ? colors.brandTertiary : colors.surfaceSecondary }}
          >
            <T v="caption" color={sel ? "brandPrimary" : "onSurfaceSecondary"}>{o.label}</T>
          </Pressable>
        );
      })}
    </View>
  );
}
