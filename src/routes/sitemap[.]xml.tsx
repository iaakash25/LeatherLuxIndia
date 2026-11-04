import { createFileRoute } from "@tanstack/react-router";
import { COLLECTIONS, images, PRODUCTS } from "@/lib/catalog";
import { fetchCatalog } from "@/lib/catalog-live";
import { buildSitemap } from "@/lib/sitemap";

// The list of pages (and their pictures) Google should know about, built from the live catalogue so a product added in the admin console
// appears by itself, with its photos.
export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        const products = await fetchCatalog().catch(() => PRODUCTS);
        const body = buildSitemap([
          { path: "/", images: [images.hero] },
          ...COLLECTIONS.map((c) => ({ path: `/collections/${c.slug}`, images: [c.image] })),
          ...products.map((p) => ({ path: `/products/${p.slug}`, images: p.images })),
        ]);
        return new Response(body, {
          headers: {
            "content-type": "application/xml; charset=utf-8",
            "cache-control": "public, max-age=3600, s-maxage=3600",
          },
        });
      },
    },
  },
});
