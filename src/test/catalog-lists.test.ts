import { describe, expect, it } from "vitest";
import { homeRails, listProduct, PRODUCTS, type Product } from "@/lib/catalog";

const piece = (over: Partial<Product>): Product => ({
  slug: "p", name: "P", type: "Wallets", gender: "men", price: 1000, colours: ["Ink"], images: ["/media/a.webp"], stock: "in",
  tagline: "t", material: "m", dimensions: "d", rank: 0, ...over,
});

describe("homeRails", () => {
  it("picks at most 4 new pieces, 8 bestsellers and 4 gifts, and lists the gifts cheapest first", () => {
    const many = Array.from({ length: 12 }, (_, i) => piece({ slug: `p-${i}`, isNew: true, bestseller: true, gift: true, price: 5000 - i * 100 }));
    const r = homeRails(many);
    expect(r.signature.map((p) => p.slug)).toEqual(["p-0", "p-1", "p-2", "p-3"]);
    expect(r.best).toHaveLength(8);
    expect(r.gifts.map((p) => p.price)).toEqual([3900, 4000, 4100, 4200]); // the four cheapest, cheapest first
  });

  it("does not reorder the list it is given", () => {
    const list = [piece({ slug: "dear", gift: true, price: 5000 }), piece({ slug: "cheap", gift: true, price: 500 })];
    const r = homeRails(list);
    expect(r.gifts.map((p) => p.slug)).toEqual(["cheap", "dear"]);
    expect(list.map((p) => p.slug)).toEqual(["dear", "cheap"]);
  });

  it("works on the built-in catalogue, and only picks what each row is for", () => {
    const r = homeRails(PRODUCTS);
    expect(r.signature.every((p) => p.isNew)).toBe(true);
    expect(r.best.every((p) => p.bestseller)).toBe(true);
    expect(r.gifts.every((p) => p.gift)).toBe(true);
  });
});

describe("listProduct", () => {
  it("drops the long copy only the product page reads, and keeps everything a card or a search uses", () => {
    const full = piece({
      description: "A long paragraph.", imageLabels: ["Front"], tags: ["wallet"], thumbs: ["/media/a-sm.webp"], sku: "LLI-1", hoverEffect: "zoom", availability: "active",
    });
    const slim = listProduct(full);
    expect("description" in slim).toBe(false);
    expect("imageLabels" in slim).toBe(false);
    expect(slim).toMatchObject({ slug: "p", name: "P", price: 1000, images: ["/media/a.webp"], thumbs: ["/media/a-sm.webp"], tags: ["wallet"], sku: "LLI-1", hoverEffect: "zoom", availability: "active", tagline: "t" });
    expect(full.description).toBe("A long paragraph."); // the original is untouched
  });
});
