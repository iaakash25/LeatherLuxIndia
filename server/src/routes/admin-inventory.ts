import express, { Router } from "express";
import { z } from "zod";
import { query, withTx } from "../db/pool.js";
import { AVAILABILITIES, HOVER_EFFECTS, stockStatus, type ProductRow } from "../lib/catalog.js";
import { invalidateCatalog } from "../lib/caches.js";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import { sniffImage } from "../lib/image-type.js";
import { MANUAL_REASONS, STOCK_MAX, adjustStockTx, logMovement } from "../lib/inventory.js";
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
  active: p.active, availability: p.availability, hoverEffect: p.hover_effect, needsReview: p.needs_review, isNew: p.is_new, bestseller: p.bestseller, gift: p.gift,
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
  status: z.enum(["all", "active", "hidden", "inactive", "coming_soon", "low", "out", "review"]).default("all"),
  sort: z.enum(["rank", "name", "price-asc", "price-desc", "stock-asc", "updated"]).default("rank"),
  limit: z.coerce.number().int().min(1).max(500).default(200),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});
const STATUS_SQL = {
  all: "TRUE", active: "active", hidden: "NOT active", inactive: "(active AND availability = 'inactive')", coming_soon: "(active AND availability = 'coming_soon')", low: "(stock_qty > 0 AND stock_qty <= reorder_level)", out: "stock_qty = 0", review: "needs_review",
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
              count(*) FILTER (WHERE active AND availability = 'inactive')::int AS inactive,
              count(*) FILTER (WHERE active AND availability = 'coming_soon')::int AS coming_soon,
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
      products: s["total"], active: s["active"], hidden: s["hidden"], inactive: s["inactive"], comingSoon: s["coming_soon"], needsReview: s["needs_review"], lowStock: s["low_stock"], outOfStock: s["out_of_stock"],
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
  availability: z.enum(AVAILABILITIES),
  hoverEffect: z.enum(HOVER_EFFECTS),
  needsReview: z.boolean(),
  isNew: z.boolean(),
  bestseller: z.boolean(),
  gift: z.boolean(),
}).partial().strict().refine((v) => Object.keys(v).length > 0, "Nothing to update");

// Column names come from this fixed map, never from the request.
const COLUMN: Record<keyof z.infer<typeof patchBody>, string> = {
  name: "name", type: "type", gender: "gender", priceInr: "price_inr", costInr: "cost_inr", colours: "colours", sizes: "sizes", tagline: "tagline",
  material: "material", dimensions: "dimensions", description: "description", tags: "tags", reorderLevel: "reorder_level", active: "active",
  availability: "availability", hoverEffect: "hover_effect", needsReview: "needs_review", isNew: "is_new", bestseller: "bestseller", gift: "gift",
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
  const b = z.object({ assetId: z.number().int().min(1).optional(), photoId: z.uuid().optional(), label: clean(40).optional() }).strict()
    .refine((v) => (v.assetId === undefined) !== (v.photoId === undefined), "Send either a library photo (assetId) or an uploaded photo (photoId)").parse(req.body);
  const product = await withTx(async (db) => {
    const p = (await db.query<ProductRow>("SELECT * FROM products WHERE slug = $1 FOR UPDATE", [s])).rows[0];
    if (!p) throw notFound("Product not found");
    if (p.images.length >= GALLERY_MAX) throw badRequest(`A product can have at most ${GALLERY_MAX} photos`);
    if (b.photoId) {
      if (!(await db.query("SELECT 1 FROM product_photos WHERE id = $1", [b.photoId])).rowCount) throw notFound("Photo not found");
      const ref = photoRef(b.photoId);
      if (p.images.includes(ref)) throw conflict("That photo is already on this product", "photo_already_added");
      await saveGallery(db, s, [...p.images, ref], [...padLabels(p), b.label || `View ${p.images.length + 1}`]);
    } else {
      const a = (await db.query<AssetRow>("SELECT * FROM media_assets WHERE id = $1 FOR UPDATE", [b.assetId])).rows[0];
      if (!a) throw notFound("Photo not found");
      if (a.status !== "spare" || !a.web_path) throw conflict("Only a spare photo that has been processed can be added to a product", "photo_not_available");
      await saveGallery(db, s, [...p.images, a.web_path], [...padLabels(p), b.label || "Extra"]);
      await db.query("UPDATE media_assets SET status = 'used', product_slug = $2, updated_at = now() WHERE id = $1", [a.id, s]);
    }
    return (await db.query<ProductRow>("SELECT * FROM products WHERE slug = $1", [s])).rows[0]!;
  });
  invalidateCatalog();
  await audit(req, "admin_photo_add", me(req).id, { slug: s, ...(b.assetId ? { assetId: b.assetId } : { photoId: b.photoId }) });
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

// ── Photos uploaded from the browser ─────────────────────────────────────────────────────────
/** How a stored upload is referred to in products.images. */
const photoRef = (id: string) => `/api/photos/${id}`;
const PHOTO_FULL_MAX = 1024 * 1024, PHOTO_THUMB_MAX = 256 * 1024;

/**
 * The browser resizes a photo before sending it (Vercel limits a request to 4.5 MB, and a camera original is bigger), and sends the
 * full-size and the small version together as ONE body: [4 bytes: size of the full-size file][full-size file][small file].
 * Both are checked here by their first bytes, never by what the client says they are. SVG is not accepted: it can carry scripts.
 */
adminInventoryRouter.post("/photos", express.raw({ type: "application/octet-stream", limit: "1400kb" }), async (req, res) => {
  const body = req.body as unknown;
  if (!Buffer.isBuffer(body) || body.length < 16) throw badRequest("Send the photo as the resized image data from the Add product form.");
  const fullLen = body.readUInt32BE(0);
  if (fullLen < 1 || fullLen > PHOTO_FULL_MAX || 4 + fullLen >= body.length) throw badRequest("That photo is too large or damaged. Photos can be up to 1 MB once resized.");
  const full = body.subarray(4, 4 + fullLen), thumb = body.subarray(4 + fullLen);
  if (thumb.length < 1 || thumb.length > PHOTO_THUMB_MAX) throw badRequest("The small version of the photo is missing or too large.");
  const type = sniffImage(full);
  if (!type) throw badRequest("That isn't a valid PNG, JPEG or WebP image.");
  if (sniffImage(thumb) !== type) throw badRequest("The photo and its small version must be the same kind of image.");
  const { rows } = await query<{ id: string }>(
    "INSERT INTO product_photos (content_type, full_data, thumb_data, created_by) VALUES ($1,$2,$3,$4) RETURNING id",
    [type, full, thumb, me(req).id],
  );
  const id = rows[0]!.id;
  // Housekeeping: uploads that never ended up on a product (a form abandoned half way) are removed after a day.
  await query(
    `DELETE FROM product_photos WHERE created_at < now() - interval '1 day'
        AND NOT EXISTS (SELECT 1 FROM products p WHERE '/api/photos/' || product_photos.id::text = ANY(p.images))`,
  ).catch(() => undefined);
  await audit(req, "admin_photo_upload", me(req).id, { photoId: id, bytes: body.length });
  res.status(201).json({ photo: { id, url: photoRef(id) } });
});

// ── Add a product ────────────────────────────────────────────────────────────────────────────
const NEW_SKU_PREFIX = "LLI-NEW-";
const slugify = (name: string) => name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70) || "product";
const createBody = z.object({
  name: clean(120).pipe(z.string().min(1, "Enter a name")),
  sku: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9._-]{1,39}$/, "Use letters, digits, - . _ (2 to 40 characters)").optional(),
  type: clean(60).pipe(z.string().min(1, "Enter a category")),
  gender: z.enum(["women", "men", "unisex"]),
  priceInr: z.number().int().min(1, "Enter a price").max(10_000_000),
  costInr: z.number().int().min(0).max(10_000_000).nullable().default(null),
  stockQty: z.number().int().min(0).max(STOCK_MAX).default(0),
  reorderLevel: z.number().int().min(0).max(10_000).default(3),
  colours: z.array(clean(40).pipe(z.string().min(1))).min(1, "Add at least one colour").max(12).transform(uniq),
  sizes: z.array(clean(20).pipe(z.string().min(1))).max(12).nullable().default(null).transform((v) => (v && v.length ? uniq(v) : null)),
  tagline: clean(200).default(""),
  material: clean(200).default(""),
  dimensions: clean(120).default(""),
  description: clean(2000).default(""),
  tags: z.array(clean(40).pipe(z.string().min(1)).transform((t) => t.toLowerCase())).max(30).default([]).transform(uniq),
  isNew: z.boolean().default(false),
  bestseller: z.boolean().default(false),
  gift: z.boolean().default(false),
  active: z.boolean().default(true),
  availability: z.enum(AVAILABILITIES).default("active"),
  hoverEffect: z.enum(HOVER_EFFECTS).default("swap"),
  // One to four photos, uploaded first (POST /photos); the first is the cover.
  photos: z.array(z.object({ id: z.uuid(), label: clean(40).default("") }).strict()).min(1, "Add at least one photo").max(4, "A new product can have up to 4 photos"),
}).strict();

adminInventoryRouter.post("/inventory", async (req, res) => {
  const b = createBody.parse(req.body);
  if (new Set(b.photos.map((x) => x.id)).size !== b.photos.length) throw badRequest("The same photo was added twice");
  const row = await withTx(async (db) => {
    const found = (await db.query<{ id: string }>("SELECT id FROM product_photos WHERE id = ANY($1::uuid[])", [b.photos.map((x) => x.id)])).rowCount;
    if (found !== b.photos.length) throw badRequest("One of the photos was not found. Add it again.");

    const base = slugify(b.name);
    let slugValue = base;
    for (let n = 2; (await db.query("SELECT 1 FROM products WHERE slug = $1", [slugValue])).rowCount; n++) slugValue = `${base.slice(0, 66)}-${n}`;
    const next = Number((await db.query<{ n: string }>(String.raw`SELECT coalesce(max(substring(sku from '^LLI-NEW-(\d+)$')::int), 0) + 1 AS n FROM products`)).rows[0]!.n);
    const sku = b.sku ?? `${NEW_SKU_PREFIX}${String(next).padStart(3, "0")}`;
    const rank = Number((await db.query<{ r: string }>("SELECT coalesce(max(rank), 0) + 1 AS r FROM products")).rows[0]!.r);

    let inserted: ProductRow;
    try {
      inserted = (await db.query<ProductRow>(
        `INSERT INTO products (slug, name, type, gender, price_inr, cost_inr, colours, sizes, images, image_labels, is_new, bestseller, gift, stock_qty,
                               tagline, material, dimensions, description, tags, rank, active, availability, hover_effect, sku, reorder_level, needs_review)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,false) RETURNING *`,
        [slugValue, b.name, b.type, b.gender, b.priceInr, b.costInr, b.colours, b.sizes, b.photos.map((x) => photoRef(x.id)),
          b.photos.map((x, i) => x.label || (i === 0 ? "Front" : `View ${i + 1}`)), b.isNew, b.bestseller, b.gift, b.stockQty, b.tagline, b.material,
          b.dimensions, b.description, b.tags, rank, b.active, b.availability, b.hoverEffect, sku, b.reorderLevel],
      )).rows[0]!;
    } catch (err) {
      if ((err as { constraint?: string }).constraint === "products_sku_key") throw conflict(`The style number ${sku} is already used by another product`, "sku_taken");
      throw err;
    }
    if (b.stockQty > 0) await logMovement(db, { slug: slugValue, delta: b.stockQty, qtyAfter: b.stockQty, reason: "opening_stock", note: "Added in the admin console", userId: me(req).id });
    return inserted;
  });
  invalidateCatalog();
  await audit(req, "admin_product_create", me(req).id, { slug: row.slug, sku: row.sku, photos: b.photos.length });
  res.status(201).json({ product: shape(row) });
});
