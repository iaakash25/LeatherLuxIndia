import type { PoolClient } from "pg";
import { withTx, type Queryable } from "../db/pool.js";
import { invalidateCatalog } from "./caches.js";
import { badRequest, conflict, notFound } from "./errors.js";

export const STOCK_MAX = 100_000;

/** Every reason a stock number can change. Sales and cancellations are written by orders.ts, the rest by an admin. */
export const MOVEMENT_REASONS = ["opening_stock", "purchase", "sale", "order_cancelled", "return", "damage", "correction", "count"] as const;
export type MovementReason = (typeof MOVEMENT_REASONS)[number];
/** What an admin may pick when adjusting stock by hand. */
export const MANUAL_REASONS = ["purchase", "return", "damage", "correction", "count"] as const;
export type ManualReason = (typeof MANUAL_REASONS)[number];

/** Writes one ledger row for a change that was ALREADY applied to products.stock_qty in the same transaction. */
export async function logMovement(
  db: Queryable,
  m: { slug: string; delta: number; qtyAfter: number; reason: MovementReason; note?: string; orderId?: string | null; userId?: string | null },
) {
  if (m.delta === 0) return;
  await db.query(
    "INSERT INTO inventory_movements (product_slug, delta, qty_after, reason, note, order_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    [m.slug, m.delta, m.qtyAfter, m.reason, m.note ?? "", m.orderId ?? null, m.userId ?? null],
  );
}

export type StockChange = { mode: "add" | "set"; qty: number; reason: ManualReason; note?: string; userId: string | null };

/**
 * Changes one product's stock inside the caller's transaction: locks the row, never lets it go below zero, and leaves a
 * ledger entry. `mode: "add"` takes a signed amount (+12 received, -2 damaged); `mode: "set"` is a physical count.
 * Returns what changed, or `changed: false` when the number was already right (nothing is logged).
 */
export async function adjustStockTx(db: PoolClient, slug: string, c: StockChange) {
  const row = (await db.query<{ stock_qty: number }>("SELECT stock_qty FROM products WHERE slug = $1 FOR UPDATE", [slug])).rows[0];
  if (!row) throw notFound("Product not found");
  const before = row.stock_qty;
  const after = c.mode === "add" ? before + c.qty : c.qty;
  if (after < 0) throw conflict(`Stock cannot go below zero: ${before} in stock, change of ${c.qty}`, "insufficient_stock");
  if (after > STOCK_MAX) throw badRequest(`Stock cannot be more than ${STOCK_MAX.toLocaleString("en-IN")}`);
  const delta = after - before;
  if (c.mode === "add" && ((c.reason === "purchase" || c.reason === "return") && delta < 0)) throw badRequest(`A ${c.reason} must add stock; use "damage" or "correction" to remove it`);
  if (c.mode === "add" && c.reason === "damage" && delta > 0) throw badRequest('Damaged stock must be removed; use "purchase", "return" or "correction" to add it');
  if (delta === 0) return { changed: false as const, before, after };
  await db.query("UPDATE products SET stock_qty = $2, updated_at = now() WHERE slug = $1", [slug, after]);
  await logMovement(db, { slug, delta, qtyAfter: after, reason: c.reason, ...(c.note ? { note: c.note } : {}), userId: c.userId });
  return { changed: true as const, before, after };
}

export async function adjustStock(slug: string, c: StockChange) {
  const r = await withTx((db) => adjustStockTx(db, slug, c));
  if (r.changed) invalidateCatalog();
  return r;
}
