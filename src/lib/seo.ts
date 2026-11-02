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
