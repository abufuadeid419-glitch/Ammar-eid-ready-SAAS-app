import { useMutation, useQuery } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@/src/api";
import { floatBarSpace } from "@/src/components/FloatingTabBar";
import { usesNativeTabs } from "@/src/navigation";
import { pendingCount, readCache, syncQueue, writeCache } from "@/src/offline";
import { queryClient } from "@/src/query-client";
import { useToast } from "@/src/ui";

// GET with offline cache: last good response is persisted; when offline (or while
// local changes are waiting to sync) the cached copy is served.
export async function fetchCached<T = any>(path: string): Promise<T> {
  await syncQueue();
  if (pendingCount() > 0) {
    const c = await readCache<T>(path);
    if (c != null) return c;
  }
  try {
    const d = await api<T>(path);
    writeCache(path, d);
    return d;
  } catch (e: any) {
    if (e.offline) {
      const c = await readCache<T>(path);
      if (c != null) return c;
    }
    throw e;
  }
}

// Warm the offline cache for everything a distributor needs in the field (customers, stock,
// prices, previous invoices/vouchers and the encrypted organization identity for receipts).
export const AGENT_OFFLINE_PATHS = ["/org/profile", "/org/logo", "/customers", "/customer-types", "/my/inventory", "/products", "/sales", "/collections", "/payment-vouchers", "/sales-returns", "/warehouse-returns", "/deliveries", "/stock-requests", "/routes/mine", "/stats/overview", "/targets"];
export function prefetchOffline(paths: string[]) {
  return Promise.all(paths.map((p) => queryClient.prefetchQuery({ queryKey: [p], queryFn: () => fetchCached(p), networkMode: "always" }).catch(() => {})));
}

export function useApi<T = any>(path: string, enabled = true, refetchMs?: number) {
  return useQuery<T>({
    queryKey: [path],
    enabled,
    networkMode: "always",
    refetchInterval: refetchMs ?? false,
    queryFn: () => fetchCached<T>(path),
  });
}

export function useMutate<B = any>(method: string, path: string | ((b: B) => string), success?: string, onDone?: (r: any) => void) {
  const toast = useToast();
  return useMutation({
    networkMode: "always",
    mutationFn: (body: B) =>
      api(typeof path === "function" ? path(body) : path, { method, body: method === "DELETE" ? undefined : body }),
    onSuccess: (r) => {
      queryClient.invalidateQueries();
      if (success) toast(success);
      onDone?.(r);
    },
    onError: (e: any) => toast(e.message, "error"),
  });
}

// Bottom padding for content inside a tab screen: NativeTabs include the bar in the inset;
// the floating pill bar (Android / older iOS / web) overlays content, so reserve its full space.
export function useBottomChrome() {
  const insets = useSafeAreaInsets();
  return usesNativeTabs ? insets.bottom : floatBarSpace(insets);
}
