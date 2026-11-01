import { useQuery } from "@tanstack/react-query";
import { api, apiEnabled } from "./api";

type StoreStatus = { ordersOpen: boolean };
const NOT_YET: StoreStatus = { ordersOpen: false };

/**
 * Whether orders can be placed. The server decides (ORDERS_OPEN in server/.env; it refuses orders itself while closed), and the shop
 * follows it, so no checkout is ever offered that would be turned away. Until the server answers, or when it cannot be reached,
 * the answer is "not yet". `settled` is false until the first answer, for pages that would rather wait than flash the closed state.
 */
export function useOrdersOpen(): { ordersOpen: boolean; settled: boolean } {
  const q = useQuery({
    queryKey: ["store-status"],
    queryFn: () => api<StoreStatus>("/store-status", { timeoutMs: 5000 }),
    enabled: apiEnabled,
    staleTime: 30_000,
    retry: 1,
    placeholderData: NOT_YET,
  });
  return { ordersOpen: apiEnabled && (q.data?.ordersOpen ?? false), settled: !apiEnabled || q.isSuccess || q.isError };
}
