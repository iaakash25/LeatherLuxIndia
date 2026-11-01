import { Router } from "express";
import { z } from "zod";
import { query, withTx } from "../db/pool.js";
import { stockStatus, type ProductRow } from "../lib/catalog.js";
import { invalidateCatalog } from "../lib/caches.js";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import { MANUAL_REASONS, STOCK_MAX, adjustStockTx } from "../lib/inventory.js";
import { audit } from "../lib/session.js";
import { me } from "../middleware/auth.js";

/**
 * Inventory: the full product record (prices, cost, stock, details, photos), the stock ledger and the photo library.
 * Mounted inside adminRouter, so requireAuth + requireAdmin already ran.
 */
export const adminInventoryRouter = Router();

const slug = z.string().min(1).max(80).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);
const clean = (max: number) => z.string().trim().max(max).refine((s) => !/[\u0000-\u001f<>]/.test(s), "Remove control characters and < >");
const GALLERY_MAX = 12;

/** The product as the admin console sees it: everything the storefront shows plus cost, stock count and review state. */
const shape = (p: ProductRow) => ({
  slug: p.slug, sku: p.sku, name: p.name, type: p.type, gender: p.gender,
  priceInr: p.price_inr, costInr: p.cost_inr,
  marginPct: p.cost_inr != null && p.price_inr > 0 ? Math.round(((p.price_inr - p.cost_inr) / p.price_inr) * 100) : null,
  stockQty: p.stock_qty, reorderLevel: p.reorder_level, stockStatus: stockStatus(p.stock_qty, p.reorder_level),
  active: p.active, needsReview: p.needs_review, isNew: p.is_new, bestseller: p.bestseller, gift: p.gift,
  colours: p.colours, sizes: p.sizes, material: p.material, tagline: p.tagline, dimensions: p.dimensions, description: p.description, tags: p.tags,
  images: p.images, imageLabels: padLabels(p), sourceFolder: p.source_folder, updatedAt: p.updated_at,
});
const padLabels = (p: Pick<ProductRow, "images" | "image_labels">) => p.images.map((_, i) => p.image_labels[i] ?? "");

const escapeLike = (s: string) => s.replace(/[\\%_]/g, "\\$&");
const num = (v: string | number | null | undefined) => Number(v ?? 0);

// ── List + summary ───────────────────────────────────────────────────────────────────────────
const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  type: z.string().trim().min(1).max(60).optional(),
  gender: z.enum(["women", "men", "unisex"]).optional(),
  status: z.enum(["all", "active", "hidden", "low", "out", "review"]).default("all"),
  sort: z.enum(["rank", "name", "price-asc", "price-desc", "stock-asc", "updated"]).default("rank"),
  limit: z.coerce.number().int().min(1).max(500).default(200),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});
const STATUS_SQL = {
  all: "TRUE", active: "active", hidden: "NOT active", low: "(stock_qty > 0 AND stock_qty <= reorder_level)", out: "stock_qty = 0", review: "needs_review",
} as const;
const SORT_SQL = {
  rank: "rank ASC, slug", name: "lower(name), slug", "price-asc": "price_inr ASC, slug", "price-desc": "price_inr DESC, slug",
  "stock-asc": "stock_qty ASC, slug", updated: "updated_at DESC, slug",
} as const;

adminInventoryRouter.get("/inventory", async (req, res) => {
  const f = listQuery.parse(req.query);
  const params: unknown[] = [];
  const add = (v: unknown) => { params.push(v); return `$${params.length}`; };
  const where: string[] = [STATUS_SQL[f.status]];
  if (f.type) where.push(`type = ${add(f.type)}`);
  if (f.gender) where.push(`gender = ${add(f.gender)}`);
  for (const w of (f.q ?? "").toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8)) {
    where.push(`lower(name || ' ' || coalesce(sku, '') || ' ' || type || ' ' || array_to_string(colours, ' ') || ' ' || array_to_string(tags, ' ')) LIKE ${add(`%${escapeLike(w)}%`)}`);
  }
  const clause = where.join(" AND ");
  const [{ rows: list }, { rows: count }, { rows: sum }, { rows: types }] = await Promise.all([
    query<ProductRow>(`SELECT * FROM products WHERE ${clause} ORDER BY ${SORT_SQL[f.sort]} LIMIT ${add(f.limit)} OFFSET ${add(f.offset)}`, params),
    query<{ n: string }>(`SELECT count(*) AS n FROM products WHERE ${clause}`, params.slice(0, params.length - 2)),
    query<Record<string, string | number | null>>(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE active)::int AS active,
              count(*) FILTER (WHERE NOT active)::int AS hidden,
              count(*) FILTER (WHERE needs_review)::int AS needs_review,
              count(*) FILTER (WHERE stock_qty > 0 AND stock_qty <= reorder_level)::int AS low_stock,
              count(*) FILTER (WHERE stock_qty = 0)::int AS out_of_stock,
              count(*) FILTER (WHERE cost_inr IS NULL)::int AS missing_cost,
              coalesce(sum(stock_qty), 0)::int AS units,
              coalesce(sum(price_inr::bigint * stock_qty), 0)::text AS retail_value,
              coalesce(sum(cost_inr::bigint * stock_qty), 0)::text AS cost_value
         FROM products`,
    ),
    query<{ type: string; n: number }>("SELECT type, count(*)::int AS n FROM products GROUP BY type ORDER BY type"),
  ]);
  const s = sum[0]!;
  res.json({
    total: num(count[0]!.n),
    products: list.map(shape),
    summary: {
      products: s["total"], active: s["active"], hidden: s["hidden"], needsReview: s["needs_review"], lowStock: s["low_stock"], outOfStock: s["out_of_stock"],
      missingCost: s["missing_cost"], units: s["units"], retailValueInr: num(s["retail_value"]), costValueInr: num(s["cost_value"]),
    },
    types: types.map((t) => ({ type: t.type, count: t.n })),
  });
});

// ── One product + its stock history ──────────────────────────────────────────────────────────
adminInventoryRouter.get("/inventory/:slug", async (req, res) => {
  const s = slug.parse(req.params.slug);
  const p = (await query<ProductRow>("SELECT * FROM products WHERE slug = $1", [s])).rows[0];
  if (!p) throw notFound("Product not found");
  const { rows } = await query<{ id: string; delta: number; qty_after: number; reason: string; note: string; order_id: string | null; created_at: Date; by: string | null }>(
    `SELECT m.id, m.delta, m.qty_after, m.reason, m.note, m.order_id, m.created_at, u.name AS by
       FROM inventory_movements m LEFT JOIN users u ON u.id = m.created_by
      WHERE m.product_slug = $1 ORDER BY m.created_at DESC, m.id DESC LIMIT 50`,
    [s],
  );
  res.json({
    product: shape(p),
    movements: rows.map((m) => ({ id: m.id, delta: m.delta, qtyAfter: m.qty_after, reason: m.reason, note: m.note, orderId: m.order_id, by: m.by, createdAt: m.created_at })),
  });
});

// ── Edit details and prices ──────────────────────────────────────────────────────────────────
const uniq = (xs: string[]) => [...new Set(xs)];
const patchBody = z.object({
  name: clean(120).pipe(z.string().min(1)),
  type: clean(60).pipe(z.string().min(1)),
  gender: z.enum(["women", "men", "unisex"]),
  priceInr: z.number().int().min(1).max(10_000_000),
  costInr: z.number().int().min(0).max(10_000_000).nullable(),
  colours: z.array(clean(40).pipe(z.string().min(1))).min(1).max(12).transform(uniq),
  sizes: z.array(clean(20).pipe(z.string().min(1))).max(12).nullable().transform((v) => (v && v.length ? uniq(v) : null)),
  tagline: clean(200),
  material: clean(200),
  dimensions: clean(120),
  description: clean(2000),
  tags: z.array(clean(40).pipe(z.string().min(1)).transform((t) => t.toLowerCase())).max(30).transform(uniq),
  reorderLevel: z.number().int().min(0).max(10_000),
  active: z.boolean(),
  needsReview: z.boolean(),
  isNew: z.boolean(),
  bestseller: z.boolean(),
  gift: z.boolean(),
}).partial().strict().refine((v) => Object.keys(v).length > 0, "Nothing to update");

// Column names come from this fixed map, never from the request.
const COLUMN: Record<keyof z.infer<typeof patchBody>, string> = {
  name: "name", type: "type", gender: "gender", priceInr: "price_inr", costInr: "cost_inr", colours: "colours", sizes: "sizes", tagline: "tagline",
  material: "material", dimensions: "dimensions", description: "description", tags: "tags", reorderLevel: "reorder_level", active: "active",
  needsReview: "needs_review", isNew: "is_new", bestseller: "bestseller", gift: "gift",
};

adminInventoryRouter.patch("/inventory/:slug", async (req, res) => {
  const s = slug.parse(req.params.slug);
  const body = patchBody.parse(req.body);
  const entries = Object.entries(body).filter(([, v]) => v !== undefined) as [keyof typeof COLUMN, unknown][];
  const { product, changes } = await withTx(async (db) => {
    const before = (await db.query<ProductRow>("SELECT * FROM products WHERE slug = $1 FOR UPDATE", [s])).rows[0];
    if (!before) throw notFound("Product not found");
    const sets = entries.map(([k], i) => `${COLUMN[k]} = $${i + 2}`);
    const { rows } = await db.query<ProductRow>(
      `UPDATE products SET ${sets.join(", ")}, updated_at = now() WHERE slug = $1 RETURNING *`,
      [s, ...entries.map(([, v]) => v)],
    );
    const old = shape(before) as Record<string, unknown>, now = shape(rows[0]!) as Record<string, unknown>;
    const diff: Record<string, [unknown, unknown]> = {};
    for (const [k] of entries) if (JSON.stringify(old[k]) !== JSON.stringify(now[k])) diff[k] = [old[k], now[k]];
    return { product: rows[0]!, changes: diff };
  });
  invalidateCatalog();
  await audit(req, "admin_inventory_update", me(req).id, { slug: s, changes: JSON.stringify(changes).slice(0, 1500) });
  res.json({ product: shape(product) });
});

// ── Stock adjustments ────────────────────────────────────────────────────────────────────────
const stockBody = z.object({
  mode: z.enum(["add", "set"]),
  qty: z.number().int().min(-STOCK_MAX).max(STOCK_MAX),
  reason: z.enum(MANUAL_REASONS),
  note: clean(200).optional(),
}).refine((b) => (b.mode === "set" ? b.qty >= 0 : b.qty !== 0), "Enter a quantity (a stock count cannot be negative; an adjustment cannot be zero)")
  .refine((b) => b.mode === "add" || b.reason === "count" || b.reason === "correction", "A set-to count is recorded as a stock count or a correction");

adminInventoryRouter.post("/inventory/:slug/stock", async (req, res) => {
  const s = slug.parse(req.params.slug);
  const b = stockBody.parse(req.body);
  const change = await withTx((db) => adjustStockTx(db, s, { ...b, userId: me(req).id }));
  if (change.changed) invalidateCatalog();
  await audit(req, "admin_stock_adjust", me(req).id, { slug: s, mode: b.mode, qty: b.qty, reason: b.reason, before: change.before, after: change.after });
  const p = (await query<ProductRow>("SELECT * FROM products WHERE slug = $1", [s])).rows[0]!;
  res.json({ product: shape(p), change });
});

// ── Photo library and a product's gallery ────────────────────────────────────────────────────
type AssetRow = { id: string; camera_no: number; source_file: string; status: string; note: string; product_slug: string | null; web_path: string | null; thumb_path: string | null };
const assetShape = (a: AssetRow) => ({
  id: Number(a.id), cameraNo: a.camera_no, sourceFile: a.source_file, status: a.status, note: a.note, productSlug: a.product_slug, webPath: a.web_path, thumbPath: a.thumb_path,
});

adminInventoryRouter.get("/media-library", async (req, res) => {
  const q = z.object({
    status: z.enum(["used", "spare", "rejected", "duplicate"]).optional(),
    limit: z.coerce.number().int().min(1).max(500).default(200),
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
  }).parse(req.query);
  const [{ rows }, { rows: counts }] = await Promise.all([
    query<AssetRow>("SELECT * FROM media_assets WHERE ($1::text IS NULL OR status = $1) ORDER BY camera_no, id LIMIT $2 OFFSET $3", [q.status ?? null, q.limit, q.offset]),
    query<{ status: string; n: number }>("SELECT status, count(*)::int AS n FROM media_assets GROUP BY status"),
  ]);
  res.json({ assets: rows.map(assetShape), counts: Object.fromEntries(counts.map((c) => [c.status, c.n])) });
});

/** Replaces a product's photo list inside the caller's transaction, keeping labels the same length. */
async function saveGallery(db: { query: (sql: string, params: unknown[]) => Promise<unknown> }, s: string, images: string[], labels: string[]) {
  await db.query("UPDATE products SET images = $2, image_labels = $3, updated_at = now() WHERE slug = $1", [s, images, labels]);
}

adminInventoryRouter.post("/inventory/:slug/images", async (req, res) => {
  const s = slug.parse(req.params.slug);
  const b = z.object({ assetId: z.number().int().min(1), label: clean(40).optional() }).parse(req.body);
  const product = await withTx(async (db) => {
    const p = (await db.query<ProductRow>("SELECT * FROM products WHERE slug = $1 FOR UPDATE", [s])).rows[0];
    if (!p) throw notFound("Product not found");
    const a = (await db.query<AssetRow>("SELECT * FROM media_assets WHERE id = $1 FOR UPDATE", [b.assetId])).rows[0];
    if (!a) throw notFound("Photo not found");
    if (a.status !== "spare" || !a.web_path) throw conflict("Only a spare photo that has been processed can be added to a product", "photo_not_available");
    if (p.images.length >= GALLERY_MAX) throw badRequest(`A product can have at most ${GALLERY_MAX} photos`);
    await saveGallery(db, s, [...p.images, a.web_path], [...padLabels(p), b.label || "Extra"]);
    await db.query("UPDATE media_assets SET status = 'used', product_slug = $2, updated_at = now() WHERE id = $1", [a.id, s]);
    return (await db.query<ProductRow>("SELECT * FROM products WHERE slug = $1", [s])).rows[0]!;
  });
  invalidateCatalog();
  await audit(req, "admin_photo_add", me(req).id, { slug: s, assetId: b.assetId });
  res.json({ product: shape(product) });
});

const imageIndex = z.coerce.number().int().min(0).max(GALLERY_MAX);

adminInventoryRouter.delete("/inventory/:slug/images/:index", async (req, res) => {
  const s = slug.parse(req.params.slug);
  const at = imageIndex.parse(req.params.index);
  const product = await withTx(async (db) => {
    const p = (await db.query<ProductRow>("SELECT * FROM products WHERE slug = $1 FOR UPDATE", [s])).rows[0];
    if (!p) throw notFound("Product not found");
    if (at >= p.images.length) throw notFound("Photo not found");
    if (p.images.length <= 1) throw conflict("A product needs at least one photo", "last_photo");
    const removed = p.images[at]!;
    await saveGallery(db, s, p.images.filter((_, i) => i !== at), padLabels(p).filter((_, i) => i !== at));
    // A photo from the library goes back on the shelf, so it can be reused on another product.
    await db.query("UPDATE media_assets SET status = 'spare', product_slug = NULL, updated_at = now() WHERE web_path = $1 AND status = 'used'", [removed]);
    return (await db.query<ProductRow>("SELECT * FROM products WHERE slug = $1", [s])).rows[0]!;
  });
  invalidateCatalog();
  await audit(req, "admin_photo_remove", me(req).id, { slug: s, index: at });
  res.json({ product: shape(product) });
});

adminInventoryRouter.post("/inventory/:slug/images/:index/cover", async (req, res) => {
  const s = slug.parse(req.params.slug);
  const at = imageIndex.parse(req.params.index);
  const product = await withTx(async (db) => {
    const p = (await db.query<ProductRow>("SELECT * FROM products WHERE slug = $1 FOR UPDATE", [s])).rows[0];
    if (!p) throw notFound("Product not found");
    if (at >= p.images.length) throw notFound("Photo not found");
    const labels = padLabels(p);
    const front = <T>(xs: T[]) => [xs[at]!, ...xs.filter((_, i) => i !== at)];
    await saveGallery(db, s, front(p.images), front(labels));
    return (await db.query<ProductRow>("SELECT * FROM products WHERE slug = $1", [s])).rows[0]!;
  });
  invalidateCatalog();
  await audit(req, "admin_photo_cover", me(req).id, { slug: s, index: at });
  res.json({ product: shape(product) });
});
