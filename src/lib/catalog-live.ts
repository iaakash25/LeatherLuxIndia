// The storefront's product list, read from the API (prices, stock, visibility) and falling back to
// the built-in catalogue in ./catalog when the API isn't configured or can't be reached.
//
// A product's photos come in two kinds. The original sample products store a *key* of an image bundled with the
// site ("handbag", "hero", …); the photographed products store a path under /media/, which the API serves (with a
// small `-sm` version beside every photo for cards and thumbnails). `imageUrl` turns either into something an <img> can load.
import { useQuery, type QueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { api, apiEnabled, apiUrl } from "./api";
import { memoTtl } from "./ttl-memo";
import { getProduct as getStaticProduct, images, PRODUCTS, type Product } from "./catalog";

type ApiProduct = Omit<Product, "images" | "thumbs"> & { images: string[]; thumbs?: string[] };

const ASSETS: Record<string, string> = images;
const PAGE_SIZE = 100; // the API's maximum page size

export const isMediaPath = (ref: string) => ref.startsWith("/media/");
/** The URL to show for a stored photo reference; undefined for a bundled key we don't have. */
export function imageUrl(ref: string, size: "full" | "small" = "full"): string | undefined {
  if (isMediaPath(ref)) return apiUrl(size === "small" ? ref.replace(/\.webp$/, "-sm.webp") : ref);
  return ASSETS[ref];
}

function toProduct(p: ApiProduct): Product {
  const keep = p.images.map((ref, i) => ({ full: imageUrl(ref), small: imageUrl(p.thumbs?.[i] ?? ref, "full"), label: p.imageLabels?.[i] })).filter((x) => !!x.full);
  // A product whose photos we can't resolve keeps the bundled ones (or the hero) rather than a broken image.
  const fallback = getStaticProduct(p.slug)?.images ?? [images.hero];
  const { thumbs: _thumbs, ...rest } = p;
  return keep.length
    ? { ...rest, images: keep.map((x) => x.full!), thumbs: keep.map((x) => x.small ?? x.full!), imageLabels: keep.map((x) => x.label ?? "") }
    : { ...rest, images: fallback, thumbs: fallback, imageLabels: [] };
}

export async function fetchCatalog(): Promise<Product[]> {
  if (!apiEnabled) return PRODUCTS;
  const out: Product[] = [];
  for (let offset = 0; offset < 10_000; offset += PAGE_SIZE) {
    // The timeout keeps server rendering from hanging if the API is down.
    const page = await api<{ total: number; products: ApiProduct[] }>(`/products?limit=${PAGE_SIZE}&offset=${offset}`, { timeoutMs: 5000 });
    out.push(...page.products.map(toProduct));
    if (out.length >= page.total || page.products.length === 0) break;
  }
  return out;
}

export const catalogQuery = {
  queryKey: ["catalog"] as const,
  queryFn: fetchCatalog,
  staleTime: 30_000,
  retry: 1,
};

/**
 * Loader helper. On the client it fills the query cache so the page renders with live data at once.
 * During server rendering it deliberately does NOT touch the cache: the client hydrates from the
 * built-in catalogue and swaps in live data afterwards, so the two renders always match.
 */
// Server rendering only: a burst of page views shares one API request per 30 s (the API itself answers from its own cache).
const serverCatalog = memoTtl(fetchCatalog, 30_000);

export async function loadCatalog(queryClient: QueryClient): Promise<Product[]> {
  try {
    return typeof window === "undefined" ? await serverCatalog() : await queryClient.ensureQueryData(catalogQuery);
  } catch {
    return PRODUCTS;
  }
}

export function useCatalog() {
  // `placeholderData` makes the first paint (and server render) use the built-in catalogue; if the API
  // call fails the query is in an error state, `data` is undefined, and we keep using the built-in list.
  const q = useQuery({ ...catalogQuery, placeholderData: PRODUCTS });
  const products = q.data ?? PRODUCTS;
  return useMemo(
    () => ({
      products,
      /** True once the list came from the API (not the built-in fallback). */
      live: apiEnabled && q.isSuccess && !q.isPlaceholderData,
      /** True until the first answer arrives or the fallback is in use, so pages can wait before saying "not found". */
      settled: !apiEnabled || q.isSuccess || q.isError,
      /** A product on sale right now (deactivated products are absent). */
      getProduct: (slug: string) => products.find((p) => p.slug === slug),
      /** For things that outlive the listing, e.g. past orders: live first, then the built-in catalogue. */
      findAny: (slug: string) => products.find((p) => p.slug === slug) ?? getStaticProduct(slug),
    }),
    [products, q.isSuccess, q.isError, q.isPlaceholderData],
  );
}
