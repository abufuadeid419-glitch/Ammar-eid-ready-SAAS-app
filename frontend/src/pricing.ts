import { useCallback } from "react";

import { useApi } from "@/src/hooks";
import { useAuth } from "@/src/auth";

// Resolves the locked PIECE price (in the product's own currency) for a customer:
// their type's list price, else the product's base price.
export function usePriceResolver() {
  const types = useApi<any[]>("/customer-types");
  return useCallback(
    (customer: any | null, productId: string, base: number) => {
      const t = customer?.type_id ? types.data?.find((x) => x.id === customer.type_id) : null;
      const p = t?.prices?.[productId];
      return p !== undefined && p !== null ? Number(p) : Number(base || 0);
    },
    [types.data],
  );
}

// The org's live USD→SYP exchange rate (how many SYP per 1 USD).
export function useExchangeRate() {
  const { user } = useAuth();
  return Number(user?.org?.exchange_rate ?? 0);
}

// Convert a price given in the product's currency into base SYP at the current rate.
export function toBaseSyp(amount: number, currency: string | undefined, rate: number) {
  return currency === "USD" && rate > 0 ? Math.round(amount * rate * 100) / 100 : Math.round((amount || 0) * 100) / 100;
}

export function useTypeName() {
  const types = useApi<any[]>("/customer-types");
  return (id?: string | null) => (id ? types.data?.find((t) => t.id === id)?.name : undefined);
}
