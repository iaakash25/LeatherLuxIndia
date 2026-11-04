import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PRODUCTS } from "@/lib/catalog";
import { imageMeta, jsonLd, productJsonLd, seoProduct, shareImage, SITE_ORIGIN, type SeoProduct } from "@/lib/seo";
import { buildSitemap } from "@/lib/sitemap";

const base: SeoProduct = {
  slug: "aria-top-handle", name: "Aria Top-Handle", type: "Handbags", price: 14990, colours: ["Oxblood", "Ink"],
  images: ["/media/aria-front.webp", "/api/photos/abc-123", "https://leatherluxindia.com/media/aria-open.webp"],
  sku: "LLI-HBG-001", tagline: "A sculpted top-handle.", description: "A longer paragraph.", material: "Smooth leather", stock: "in",
};

describe("shareImage", () => {
  it("makes a picture address absolute on the canonical domain and keeps real web addresses", () => {
    expect(shareImage("/media/a.webp")).toBe(`${SITE_ORIGIN}/media/a.webp`);
    expect(shareImage("/api/photos/abc-123")).toBe(`${SITE_ORIGIN}/api/photos/abc-123`);
    expect(shareImage("https://cdn.example.com/x.jpg")).toBe("https://cdn.example.com/x.jpg");
  });
  it("drops anything a crawler or a chat app cannot fetch", () => {
    for (const bad of [undefined, "", "data:image/png;base64,AAAA", "javascript:alert(1)", "blob:https://x/1"]) expect(shareImage(bad), String(bad)).toBeUndefined();
  });
});

describe("imageMeta", () => {
  it("gives the picture to link previews (Open Graph and X) with its description", () => {
    const tags = imageMeta("/media/a.webp", "A bag");
    expect(tags).toEqual([
      { property: "og:image", content: `${SITE_ORIGIN}/media/a.webp` },
      { property: "og:image:alt", content: "A bag" },
      { name: "twitter:image", content: `${SITE_ORIGIN}/media/a.webp` },
      { name: "twitter:image:alt", content: "A bag" },
    ]);
  });
  it("adds nothing when there is no usable picture", () => {
    expect(imageMeta(undefined, "x")).toEqual([]);
    expect(imageMeta("data:image/png;base64,AA", "x")).toEqual([]);
  });
});

describe("productJsonLd", () => {
  const open = { site: "Leather Lux India", launched: true };

  it("names the product and lists its pictures as absolute addresses, without repeats", () => {
    const j = productJsonLd({ ...base, images: [...base.images, base.images[0]!] }, open)!;
    expect(j["@type"]).toBe("Product");
    expect(j.name).toBe("Aria Top-Handle");
    expect(j.url).toBe(`${SITE_ORIGIN}/products/aria-top-handle`);
    expect(j.image).toEqual([`${SITE_ORIGIN}/media/aria-front.webp`, `${SITE_ORIGIN}/api/photos/abc-123`, "https://leatherluxindia.com/media/aria-open.webp"]);
    expect(j.sku).toBe("LLI-HBG-001");
    expect(j.brand).toEqual({ "@type": "Brand", name: "Leather Lux India" });
    expect(j.description).toBe("A longer paragraph.");
  });

  it("states nothing before the shop opens: Google rejects a Product with no price, and nothing can be bought yet", () => {
    expect(productJsonLd(base, { site: "S", launched: false })).toBeNull();
  });

  it("states the price in rupees and whether it is in stock", () => {
    const inStock = productJsonLd(base, open)!.offers as Record<string, unknown>;
    expect(inStock).toMatchObject({ "@type": "Offer", priceCurrency: "INR", price: 14990, availability: "https://schema.org/InStock" });
    const low = productJsonLd({ ...base, stock: "low" }, open)!.offers as Record<string, unknown>;
    expect(low["availability"]).toBe("https://schema.org/InStock");
    for (const sold of [{ stock: "out" as const }, { availability: "inactive" as const }]) {
      const o = productJsonLd({ ...base, ...sold }, open)!.offers as Record<string, unknown>;
      expect(o["availability"], JSON.stringify(sold)).toBe("https://schema.org/OutOfStock");
    }
  });

  it("says nothing about a product that is only coming soon, even after launch", () => {
    expect(productJsonLd({ ...base, availability: "coming_soon", stock: "out" }, open)).toBeNull();
  });

  it("leaves out what the product does not have", () => {
    const j = productJsonLd({ ...base, sku: undefined, images: ["data:image/png;base64,AA"], description: undefined }, open)!;
    expect("sku" in j).toBe(false);
    expect("image" in j).toBe(false);
    expect(j.description).toBe("A sculpted top-handle.");
  });

  it("stays valid JSON that cannot close the script tag, whatever the product is called", () => {
    const text = jsonLd(productJsonLd({ ...base, name: `</script><script>alert(1)</script> "Quote"` }, open));
    expect(text).not.toContain("</script>");
    expect(JSON.parse(text).name).toContain("</script>");
  });

  it("works for every built-in product", () => {
    for (const p of PRODUCTS) {
      const j = productJsonLd(seoProduct(p), open)!;
      expect(j.image?.length, p.slug).toBeGreaterThan(0);
      for (const u of j.image ?? []) expect(u, p.slug).toMatch(/^https?:\/\//);
      expect((j.offers as { price: number }).price, p.slug).toBe(p.price);
    }
  });
});

describe("buildSitemap", () => {
  it("lists each page with its pictures in the image sitemap format", () => {
    const xml = buildSitemap([
      { path: "/", images: ["/assets/hero.jpg"] },
      { path: "/products/a", images: ["/media/a.webp", "/media/a.webp", "/media/b.webp", "data:image/png;base64,AA"] },
      { path: "/collections/all" },
    ]);
    expect(xml).toContain('xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"');
    expect(xml).toContain(`<url><loc>${SITE_ORIGIN}/</loc><image:image><image:loc>${SITE_ORIGIN}/assets/hero.jpg</image:loc></image:image></url>`);
    expect(xml).toContain(
      `<url><loc>${SITE_ORIGIN}/products/a</loc><image:image><image:loc>${SITE_ORIGIN}/media/a.webp</image:loc></image:image><image:image><image:loc>${SITE_ORIGIN}/media/b.webp</image:loc></image:image></url>`,
    );
    expect(xml).toContain(`<url><loc>${SITE_ORIGIN}/collections/all</loc></url>`);
    expect(xml).not.toContain("data:");
  });
  it("escapes characters that would break the XML", () => {
    const xml = buildSitemap([{ path: "/products/a", images: ["/media/a.webp?x=1&y=2"] }]);
    expect(xml).toContain("a.webp?x=1&amp;y=2");
  });
});

describe("public/robots.txt", () => {
  const robots = fs.readFileSync(path.resolve(__dirname, "../../public/robots.txt"), "utf8");
  it("keeps the API private but lets Google fetch the logo and the product photos", () => {
    expect(robots).toMatch(/^Disallow: \/api\/$/m);
    expect(robots).toMatch(/^Allow: \/api\/branding\/logo$/m);
    expect(robots).toMatch(/^Allow: \/api\/photos\/$/m);
    expect(robots).toMatch(/^Sitemap: https:\/\/leatherluxindia\.com\/sitemap\.xml$/m);
  });
});
