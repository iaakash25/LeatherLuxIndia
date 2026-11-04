import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({ api: vi.fn(), apiEnabled: true, apiUrl: (p: string) => p }));

import { api } from "@/lib/api";
import { PRODUCTS } from "@/lib/catalog";
import { Route as CollectionRoute } from "@/routes/collections.$slug";
import { Route as HomeRoute } from "@/routes/index";

const apiMock = vi.mocked(api);
const wire = (slug: string, over: Record<string, unknown> = {}) => ({
  slug, name: slug, type: "Wallets", gender: "men", price: 1990, colours: ["Oxblood"], images: ["/media/products/x/a.webp"],
  stock: "in", tagline: "t", material: "m", dimensions: "d", rank: 0, description: "A long paragraph.", imageLabels: ["Front"], ...over,
});
const fresh = () => ({ queryClient: new QueryClient() });
type Loader = (a: unknown) => Promise<Record<string, unknown>>;
const collectionLoader = CollectionRoute.options.loader as unknown as Loader;
const homeLoader = HomeRoute.options.loader as unknown as Loader;

beforeEach(() => { apiMock.mockReset(); });

// These loaders run on the server (so the page's HTML already holds the real products) and again in the browser on in-page navigation.
describe("collection page loader", () => {
  it("returns the products of that collection from the live list, including ones that exist only in the database, without the long copy", async () => {
    apiMock.mockResolvedValueOnce({
      total: 3,
      products: [wire("only-in-db"), wire("womens-bag", { gender: "women", type: "Handbags" }), wire("unisex-belt", { gender: "unisex", type: "Belts" })],
    });
    const data = await collectionLoader({ params: { slug: "men" }, context: fresh() });
    const slugs = (data["products"] as { slug: string }[]).map((p) => p.slug);
    expect(slugs).toEqual(["only-in-db", "unisex-belt"]); // not the women's bag
    for (const p of data["products"] as Record<string, unknown>[]) {
      expect("description" in p).toBe(false);
      expect("imageLabels" in p).toBe(false);
    }
    expect(data).toMatchObject({ slug: "men", title: "Men", hasComingSoon: false });
  });

  it("says whether anything is coming soon, so the Coming Soon tab can show in the first paint", async () => {
    apiMock.mockResolvedValueOnce({ total: 2, products: [wire("a"), wire("b", { availability: "coming_soon" })] });
    const data = await collectionLoader({ params: { slug: "all" }, context: fresh() });
    expect(data["hasComingSoon"]).toBe(true);
  });

  it("falls back to the built-in catalogue when the API is down, so the page still has products", async () => {
    apiMock.mockRejectedValue(new Error("down"));
    const data = await collectionLoader({ params: { slug: "all" }, context: fresh() });
    expect((data["products"] as unknown[]).length).toBe(PRODUCTS.length);
  });

  it("refuses an unknown collection", async () => {
    await expect(collectionLoader({ params: { slug: "no-such-collection" }, context: fresh() })).rejects.toBeDefined();
    expect(apiMock).not.toHaveBeenCalled();
  });
});

describe("home page loader", () => {
  it("returns the three rows from the live list", async () => {
    apiMock.mockResolvedValueOnce({
      total: 3,
      products: [wire("fresh-one", { isNew: true }), wire("star", { bestseller: true }), wire("present", { gift: true })],
    });
    const rails = (await homeLoader({ context: fresh() })) as Record<string, { slug: string }[]>;
    expect(rails["signature"]!.map((p) => p.slug)).toEqual(["fresh-one"]);
    expect(rails["best"]!.map((p) => p.slug)).toEqual(["star"]);
    expect(rails["gifts"]!.map((p) => p.slug)).toEqual(["present"]);
    expect("description" in rails["signature"]![0]!).toBe(false);
  });
});
