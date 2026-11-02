import { Router } from "express";
import { z } from "zod";
import { query } from "../db/pool.js";
import { notFound } from "../lib/errors.js";

/**
 * Public: photos uploaded in the admin console (see POST /admin/inventory/photos). A photo never changes once saved, so it is served
 * with a one-year cache, from the CDN as well as the browser. Mounted before the rate limiter, like /media: a page of products is
 * dozens of images and none of it is sensitive.
 */
export const photosRouter = Router();

async function send(req: import("express").Request, res: import("express").Response, size: "full" | "thumb") {
  const id = z.uuid().safeParse(req.params["id"]);
  if (!id.success) throw notFound("Photo not found");
  const row = (await query<{ content_type: string; data: Buffer }>(
    `SELECT content_type, ${size === "thumb" ? "thumb_data" : "full_data"} AS data FROM product_photos WHERE id = $1`,
    [id.data],
  )).rows[0];
  if (!row) throw notFound("Photo not found");
  res.set({
    "Cross-Origin-Resource-Policy": "cross-origin",
    "Cache-Control": "public, max-age=31536000, s-maxage=31536000, immutable",
    ETag: `W/"${id.data}-${size}"`,
  });
  if (req.fresh) { res.status(304).end(); return; }
  res.type(row.content_type).send(row.data);
}

photosRouter.get("/:id", (req, res) => send(req, res, "full"));
photosRouter.get("/:id/thumb", (req, res) => send(req, res, "thumb"));
