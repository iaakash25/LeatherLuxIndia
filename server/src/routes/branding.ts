import { Router } from "express";
import { query } from "../db/pool.js";
import { brandCache, cachedJson, cachedLogo, logoCache, sendCached } from "../lib/caches.js";
import { notFound } from "../lib/errors.js";

/** Public: the storefront reads its name and logo from here (editing lives in admin-config.ts). */
export const brandingRouter = Router();

type Row = { site_name: string; site_subtitle: string; logo_version: number; has_logo: boolean };

brandingRouter.get("/", async (req, res) => {
  const cached = await brandCache.get("brand", async () => {
    const row = (await query<Row>("SELECT site_name, site_subtitle, logo_version, (logo_data IS NOT NULL) AS has_logo FROM site_settings")).rows[0];
    return cachedJson({
      siteName: row?.site_name ?? "Leather Lux",
      siteSubtitle: row?.site_subtitle ?? "",
      // Versioned, so a new upload is picked up immediately even though the image itself is cached for a year.
      logoUrl: row?.has_logo ? `/api/branding/logo?v=${row.logo_version}` : null,
    });
  });
  // Browsers revalidate on every load; the server answers from memory (or with an empty 304), never the database.
  // A rename in the admin console clears the server copy, so it shows up straight away.
  sendCached(req, res, cached, "no-cache");
});

brandingRouter.get("/logo", async (req, res) => {
  const logo = await logoCache.get("logo", async () => {
    const row = (await query<{ logo_data: Buffer | null; logo_type: string | null }>("SELECT logo_data, logo_type FROM site_settings")).rows[0];
    return row?.logo_data && row.logo_type ? cachedLogo(row.logo_data, row.logo_type) : null;
  });
  if (!logo) throw notFound("No logo has been set");
  // <img> from another origin is a no-cors request, which helmet's default same-origin policy would block.
  res.set({
    "Cross-Origin-Resource-Policy": "cross-origin",
    "Cache-Control": req.query["v"] ? "public, max-age=31536000, immutable" : "public, max-age=60",
    ETag: logo.etag,
  });
  if (req.fresh) { res.status(304).end(); return; }
  res.type(logo.type).send(logo.data);
});
