import type { Product } from "./catalog";

/**
 * The one address search engines should list. The shop answers on several domains (.com and .in, with and without www, and the vercel.app
 * address); every page names this one as its canonical home, so Google gathers them into a single listing instead of splitting them.
 * Change it here (and in public/robots.txt) if the main domain ever changes.
 */
export const SITE_ORIGIN = "https://leatherluxindia.com";

/** The canonical address of a page, from its path (no search, no trailing slash). */
export const canonicalUrl = (pathname: string) =>
  SITE_ORIGIN + (pathname === "/" ? "/" : pathname.replace(/\/+$/, ""));

/** An address that may be relative (like the logo) made absolute on the canonical domain. */
export const absoluteUrl = (href: string) => new URL(href, SITE_ORIGIN).href;

/** JSON for an inline <script type="application/ld+json">: "<" is escaped so data can never close the tag early. */
export const jsonLd = (data: unknown) => JSON.stringify(data).replace(/</g, "\\u003c");

/** A picture address a crawler or a chat app can fetch: absolute on the canonical domain, http(s) only (a blank, a data: image or a script address is dropped). */
export function shareImage(src: string | undefined): string | undefined {
  if (!src) return undefined;
  try {
    const u = new URL(src, SITE_ORIGIN);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : undefined;
  } catch {
    return undefined;
  }
}

/** The tags that give a page its picture in link previews (WhatsApp, Facebook, X, LinkedIn) and tell Google which picture represents the page. */
export function imageMeta(src: string | undefined, alt: string) {
  const url = shareImage(src);
  return url
    ? [
        { property: "og:image", content: url },
        { property: "og:image:alt", content: alt },
        { name: "twitter:image", content: url },
        { name: "twitter:image:alt", content: alt },
      ]
    : [];
}

/** The part of a product that the page's head needs: small enough to travel with the page, whatever the full record holds. */
export type SeoProduct = Pick<
  Product,
  "slug" | "name" | "type" | "price" | "colours" | "images" | "sku" | "tagline" | "description" | "material" | "stock" | "availability"
>;
export const seoProduct = (p: Product): SeoProduct => ({
  slug: p.slug, name: p.name, type: p.type, price: p.price, colours: p.colours, images: p.images.slice(0, 6), sku: p.sku,
  tagline: p.tagline, description: p.description, material: p.material, stock: p.stock, availability: p.availability,
});

/**
 * Structured data for a product page: its name and pictures, so Google can show them (in Images and beside the listing).
 * The price and stock (`offers`) are added only once the shop is open (`launched`): before that nothing can be bought, and "in stock"
 * next to a price would be untrue. A product that is only coming soon never gets an offer.
 */
export function productJsonLd(p: SeoProduct, o: { site: string; launched: boolean }) {
  const url = canonicalUrl(`/products/${p.slug}`);
  const image = [...new Set(p.images.map(shareImage).filter((u): u is string => !!u))];
  const soldOut = p.stock === "out" || p.availability === "inactive";
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: p.name,
    url,
    ...(image.length ? { image } : {}),
    description: p.description || p.tagline,
    ...(p.sku ? { sku: p.sku } : {}),
    category: p.type,
    color: p.colours.join(", "),
    material: p.material,
    brand: { "@type": "Brand", name: o.site },
    ...(o.launched && p.availability !== "coming_soon"
      ? {
          offers: {
            "@type": "Offer",
            url,
            priceCurrency: "INR",
            price: p.price,
            itemCondition: "https://schema.org/NewCondition",
            availability: soldOut ? "https://schema.org/OutOfStock" : "https://schema.org/InStock",
          },
        }
      : {}),
  };
}
