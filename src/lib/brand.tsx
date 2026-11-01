// The store's name and logo, edited in the admin console and served by GET /api/branding.
// Loaded in the root route's loader so server rendering and hydration agree (no flash of the old name).
import { createContext, useContext } from "react";
import { api, apiEnabled, apiUrl } from "./api";

export type Brand = { siteName: string; siteSubtitle: string; logoUrl: string | null };

/** Shown until (or instead of) the API's answer. */
export const DEFAULT_BRAND: Brand = { siteName: "Leather Lux", siteSubtitle: "India", logoUrl: null };

/** "Leather Lux India": name and subtitle as one line, for page titles and alt text. */
export const brandTitle = (b: Brand) => [b.siteName, b.siteSubtitle].filter(Boolean).join(" ");

export async function loadBrand(): Promise<Brand> {
  if (!apiEnabled) return DEFAULT_BRAND;
  try {
    // Short timeout: this runs on every server-rendered page, so a dead API must not stall them.
    const b = await api<Brand>("/branding", { timeoutMs: 2500 });
    return { siteName: b.siteName, siteSubtitle: b.siteSubtitle, logoUrl: b.logoUrl ? apiUrl(b.logoUrl) : null };
  } catch {
    return DEFAULT_BRAND;
  }
}

const BrandContext = createContext<Brand>(DEFAULT_BRAND);
export const BrandProvider = BrandContext.Provider;
export const useBrand = () => useContext(BrandContext);

/** For a route's `head()`: the brand the root loader fetched. */
export function brandFromMatches(matches: ReadonlyArray<{ routeId: string; loaderData?: unknown }>): Brand {
  const root = matches.find((m) => m.routeId === "__root__")?.loaderData as { brand?: Brand } | undefined;
  return root?.brand ?? DEFAULT_BRAND;
}
