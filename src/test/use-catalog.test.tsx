import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({ api: vi.fn(), apiEnabled: true, apiUrl: (p: string) => p }));

import { api } from "@/lib/api";
import { useCatalog } from "@/lib/catalog-live";

const apiMock = vi.mocked(api);
const wire = (slug: string) => ({
  slug, name: "Vista Bifold Wallet", type: "Wallets", gender: "men", price: 1990, colours: ["Oxblood"], images: ["/media/products/vista/a.webp"],
  stock: "in", tagline: "t", material: "m", dimensions: "d", rank: 0,
});
const wrapper = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};

// Braces matter: a function returned from beforeEach is run as a cleanup, and mockReset() returns the mock itself.
beforeEach(() => { apiMock.mockReset(); });

// A product that exists only in the database is not in the built-in catalogue the page starts from. The page must wait for the live list
// instead of declaring the product unavailable (which is what a direct visit to its address used to show for a moment).
describe("useCatalog: settled", () => {
  it("is not settled while only the built-in list is showing, then is, with the database-only product found", async () => {
    let answer!: (v: unknown) => void;
    apiMock.mockReturnValueOnce(new Promise((r) => { answer = r; }));
    const { result } = renderHook(() => useCatalog(), { wrapper: wrapper() });

    expect(result.current.live).toBe(false);
    expect(result.current.settled).toBe(false); // was true: the placeholder list counted as an answer
    expect(result.current.getProduct("vista-bifold-wallet-antique-oxblood")).toBeUndefined();

    await act(async () => { answer({ total: 1, products: [wire("vista-bifold-wallet-antique-oxblood")] }); });
    await waitFor(() => expect(result.current.settled).toBe(true));
    expect(result.current.live).toBe(true);
    expect(result.current.getProduct("vista-bifold-wallet-antique-oxblood")?.name).toBe("Vista Bifold Wallet");
  });

  it("settles when the API fails, keeping the built-in list, so a truly missing product can then be called unavailable", async () => {
    apiMock.mockRejectedValue(new Error("down")); // twice: the catalogue query retries once, after about a second, before giving up
    const { result } = renderHook(() => useCatalog(), { wrapper: wrapper() });
    expect(result.current.settled).toBe(false);
    await waitFor(() => expect(result.current.settled).toBe(true), { timeout: 5000 });
    expect(result.current.live).toBe(false);
    expect(result.current.getProduct("aria-top-handle")).toBeDefined();
  });
});
