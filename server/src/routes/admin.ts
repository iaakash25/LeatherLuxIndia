import { Router } from "express";
import { z } from "zod";
import { query, withTx } from "../db/pool.js";
import { toProduct, type ProductRow } from "../lib/catalog.js";
import { notFound } from "../lib/errors.js";
import { adjustStockTx } from "../lib/inventory.js";
import { ORDER_STATUSES, changeStatus, hydrate } from "../lib/orders.js";
import { invalidateCatalog } from "../lib/caches.js";
import { audit } from "../lib/session.js";
import { me, requireAdmin, requireAuth } from "../middleware/auth.js";
import { adminConfigRouter } from "./admin-config.js";
import { adminInventoryRouter } from "./admin-inventory.js";

const slug = z.string().min(1).max(80).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);

export const adminRouter = Router();
adminRouter.use(requireAuth, requireAdmin);

adminRouter.get("/orders", async (req, res) => {
  const q = z.object({
    status: z.enum(ORDER_STATUSES).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
  }).parse(req.query);
  const { rows } = await query<Parameters<typeof hydrate>[0][number]>(
    "SELECT * FROM orders WHERE ($1::text IS NULL OR status = $1) ORDER BY created_at DESC LIMIT $2 OFFSET $3",
    [q.status ?? null, q.limit, q.offset],
  );
  res.json({ orders: await hydrate(rows) });
});

adminRouter.patch("/orders/:id", async (req, res) => {
  const id = z.uuid().parse(req.params.id);
  const body = z.object({
    status: z.enum(ORDER_STATUSES).optional(),
    paymentStatus: z.enum(["unpaid", "paid", "refunded"]).optional(),
  }).refine((b) => b.status || b.paymentStatus, "Nothing to update").parse(req.body);

  if (body.paymentStatus) {
    const r = await query("UPDATE orders SET payment_status = $2, updated_at = now() WHERE id = $1", [id, body.paymentStatus]);
    if (!r.rowCount) throw notFound("Order not found");
  }
  const order = body.status
    ? await changeStatus(id, body.status, { userId: null })
    : (await hydrate((await query<Parameters<typeof hydrate>[0][number]>("SELECT * FROM orders WHERE id = $1", [id])).rows))[0];
  if (!order) throw notFound("Order not found");
  await audit(req, "admin_order_update", me(req).id, { orderId: id, ...body });
  res.json({ order });
});

adminRouter.patch("/products/:slug", async (req, res) => {
  const s = slug.parse(req.params.slug);
  const b = z.object({
    stockQty: z.number().int().min(0).max(100_000).optional(),
    priceInr: z.number().int().min(1).max(10_000_000).optional(),
    active: z.boolean().optional(),
  }).refine((v) => Object.keys(v).length > 0, "Nothing to update").parse(req.body);
  // Price and visibility change in one statement; a new stock count goes through the ledger like every other stock change.
  const row = await withTx(async (db) => {
    const { rows } = await db.query<ProductRow>(
      `UPDATE products SET price_inr = COALESCE($2, price_inr), active = COALESCE($3, active), updated_at = now() WHERE slug = $1 RETURNING *`,
      [s, b.priceInr ?? null, b.active ?? null],
    );
    if (!rows[0]) throw notFound("Product not found");
    if (b.stockQty === undefined) return rows[0];
    await adjustStockTx(db, s, { mode: "set", qty: b.stockQty, reason: "correction", note: "Set from the product editor", userId: me(req).id });
    return (await db.query<ProductRow>("SELECT * FROM products WHERE slug = $1", [s])).rows[0]!;
  });
  invalidateCatalog();
  await audit(req, "admin_product_update", me(req).id, { slug: s, ...b });
  res.json({ product: toProduct(row) });
});

// Branding, offers, loyalty, discount rules and roles (inherit the auth guard above).
adminRouter.use(adminConfigRouter);
// Inventory: prices, stock, details, photos.
adminRouter.use(adminInventoryRouter);
