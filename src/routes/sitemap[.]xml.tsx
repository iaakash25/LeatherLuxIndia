import { createFileRoute } from "@tanstack/react-router";
import { COLLECTIONS, PRODUCTS } from "@/lib/catalog";
import { fetchCatalog } from "@/lib/catalog-live";
import { SITE_ORIGIN } from "@/lib/seo";

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// The list of pages Google should know about, built from the live catalogue so a product added in the admin console appears by itself.
export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        const products = await fetchCatalog().catch(() => PRODUCTS);
        const paths = [
          "/",
          ...COLLECTIONS.map((c) => `/collections/${c.slug}`),
          ...products.map((p) => `/products/${p.slug}`),
        ];
        const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${paths
          .map((p) => `  <url><loc>${xml(SITE_ORIGIN + p)}</loc></url>`)
          .join("\n")}\n</urlset>\n`;
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
