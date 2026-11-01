import { Router } from "express";
import { z } from "zod";
import { query } from "../db/pool.js";
import { COLLECTIONS, PRICE_MAX, PRICE_MIN, collectionMeta, listProducts, toProduct, type ProductRow } from "../lib/catalog.js";
import { catalogCache, cachedJson, sendCached } from "../lib/caches.js";
import { notFound } from "../lib/errors.js";

// Browsers and CDNs may reuse a list for 30 s, and for 2 more minutes while they check for a newer one.
const PUBLIC_CACHE = "public, max-age=30, stale-while-revalidate=120";

const list = z.preprocess((v) => (v === undefined ? [] : Array.isArray(v) ? v : String(v).split(",")), z.array(z.string().trim().min(1).max(40)).max(20));
const slug = z.string().min(1).max(80).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);

const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  type: list,
  colour: list,
  min: z.coerce.number().int().min(0).max(PRICE_MAX).default(PRICE_MIN),
  max: z.coerce.number().int().min(0).max(1_000_000).default(PRICE_MAX),
  inStock: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  sort: z.enum(["featured", "new", "price-asc", "price-desc"]).default("featured"),
  limit: z.coerce.number().int().min(1).max(100).default(48),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});

export const catalogRouter = Router();

async function respondList(req: import("express").Request, res: import("express").Response, rawQuery: unknown, collectionSlug?: string) {
  const f = listQuery.parse(rawQuery);
  const collection = collectionSlug ? COLLECTIONS.find((c) => c.slug === collectionSlug) : undefined;
  if (collectionSlug && !collection) throw notFound("Collection not found");
  // Key on the *parsed* filters, so ?a=1&b=2 and ?b=2&a=1 (or a stray extra parameter) share one entry.
  const words = (f.q ?? "").toLowerCase().split(/\s+/).filter(Boolean).join(" ");
  const key = `list:${collectionSlug ?? "*"}:${JSON.stringify([words, [...f.type].sort(), [...f.colour].sort(), f.min, f.max, f.inStock, f.sort, f.limit, f.offset])}`;
  const cached = await catalogCache.get(key, async () => {
    const { total, products } = await listProducts({
      collection, q: f.q, types: f.type, colours: f.colour, min: f.min, max: f.max, inStock: f.inStock,
      sort: f.sort, limit: f.limit, offset: f.offset,
    });
    return cachedJson({ ...(collection ? { collection: collectionMeta(collection) } : {}), total, limit: f.limit, offset: f.offset, products });
  });
  sendCached(req, res, cached!, PUBLIC_CACHE);
}

catalogRouter.get("/products", (req, res) => respondList(req, res, req.query));

catalogRouter.get("/products/:slug", async (req, res) => {
  const s = slug.parse(req.params.slug);
  const cached = await catalogCache.get(`product:${s}`, async () => {
    const row = (await query<ProductRow>("SELECT * FROM products WHERE slug = $1 AND active", [s])).rows[0];
    return row ? cachedJson({ product: toProduct(row) }) : null; // "not found" is remembered briefly too
  });
  if (!cached) throw notFound("Product not found");
  sendCached(req, res, cached, PUBLIC_CACHE);
});

catalogRouter.get("/collections", (_req, res) => {
  res.set("Cache-Control", "public, max-age=300");
  res.json({ collections: COLLECTIONS.map(collectionMeta) });
});

catalogRouter.get("/collections/:slug", (req, res) => respondList(req, res, req.query, slug.parse(req.params.slug)));
