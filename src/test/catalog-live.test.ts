import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({ api: vi.fn(), apiEnabled: true }));

import { api } from "@/lib/api";
import { images, PRODUCTS } from "@/lib/catalog";
import { fetchCatalog } from "@/lib/catalog-live";

const apiMock = vi.mocked(api);
const wire = (over: Record<string, unknown> = {}) => ({
  slug: "aria-top-handle", name: "Aria Top-Handle", type: "Handbags", gender: "women", price: 15990,
  colours: ["Oxblood"], images: ["handbag", "hero"], isNew: true, bestseller: true, gift: false,
  stock: "low", tagline: "t", material: "m", dimensions: "d", rank: 0, ...over,
});

beforeEach(() => apiMock.mockReset());

describe("fetchCatalog", () => {
  it("uses the API's prices and stock but maps image keys to the bundled assets", async () => {
    apiMock.mockResolvedValueOnce({ total: 1, products: [wire()] });
    const [p] = await fetchCatalog();
    expect(p).toMatchObject({ slug: "aria-top-handle", price: 15990, stock: "low" });
    expect(p!.images).toEqual([images.handbag, images.hero]);
  });

  it("keeps the built-in photos when the API sends keys the site doesn't know", async () => {
    apiMock.mockResolvedValueOnce({ total: 1, products: [wire({ images: ["nope"] })] });
    const [p] = await fetchCatalog();
    expect(p!.images).toEqual(PRODUCTS.find((x) => x.slug === "aria-top-handle")!.images);
  });

  it("shows a database-only product with the hero image rather than a broken one", async () => {
    apiMock.mockResolvedValueOnce({ total: 1, products: [wire({ slug: "brand-new-piece", images: [] })] });
    const [p] = await fetchCatalog();
    expect(p!.images).toEqual([images.hero]);
  });

  it("reads every page", async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => wire({ slug: `p-${i}` }));
    apiMock.mockResolvedValueOnce({ total: 101, products: page1 }).mockResolvedValueOnce({ total: 101, products: [wire({ slug: "p-100" })] });
    expect(await fetchCatalog()).toHaveLength(101);
    expect(apiMock).toHaveBeenCalledTimes(2);
    expect(apiMock.mock.calls[1]![0]).toContain("offset=100");
  });

  it("propagates API failures so the UI can fall back to the built-in catalogue", async () => {
    apiMock.mockRejectedValueOnce(new Error("down"));
    await expect(fetchCatalog()).rejects.toThrow("down");
  });
});
