import { shareImage, SITE_ORIGIN } from "./seo";

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export type SitemapEntry = {
  /** The page's path, e.g. "/products/aria-top-handle". */
  path: string;
  /** The page's pictures (any address `shareImage` accepts); listing them is how Google Images finds them. */
  images?: readonly string[];
};

/** The sitemap: every page, with the pictures that belong to it. Pictures that are not fetchable web addresses are left out. */
export function buildSitemap(entries: readonly SitemapEntry[]): string {
  const rows = entries.map(({ path, images = [] }) => {
    const pictures = [...new Set(images.map(shareImage).filter((u): u is string => !!u))].slice(0, 20);
    const inner = pictures.map((u) => `<image:image><image:loc>${xml(u)}</image:loc></image:image>`).join("");
    return `  <url><loc>${xml(SITE_ORIGIN + path)}</loc>${inner}</url>`;
  });
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n` +
    `${rows.join("\n")}\n</urlset>\n`
  );
}
