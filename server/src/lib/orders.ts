import crypto from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import { env } from "../config/env.js";
import { query, withTx, type Queryable } from "../db/pool.js";
import { invalidateCatalog } from "./caches.js";
import { badRequest, conflict, notFound } from "./errors.js";
import { logMovement } from "./inventory.js";

export const ORDER_STATUSES = ["pending", "confirmed", "shipped", "delivered", "cancelled"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Allowed admin transitions. Cancelling is the only way back into stock. */
export const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["shipped", "cancelled"],
  shipped: ["delivered"],
  delivered: [],
  cancelled: [],
};

export const addressSchema = z.object({
  name: z.string().trim().min(1).max(100),
  phone: z.string().trim().regex(/^(\+91[\s-]?)?[6-9]\d{9}$/, "Enter a valid 10-digit Indian mobile number"),
  line1: z.string().trim().min(1).max(150),
  line2: z.string().trim().max(150).optional(),
  city: z.string().trim().min(1).max(80),
  state: z.string().trim().min(1).max(80),
  pincode: z.string().trim().regex(/^[1-9]\d{5}$/, "Enter a valid 6-digit pincode"),
});
export type Address = z.infer<typeof addressSchema>;

type OrderRow = {
  id: string; order_number: string; user_id: string; status: OrderStatus; payment_status: string;
  subtotal_inr: number; shipping_inr: number; total_inr: number; shipping_address: Address; created_at: Date;
};
type ItemRow = { order_id: string; product_slug: string; name: string; colour: string; size: string; qty: number; unit_price_inr: number };

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function orderNumber(): string {
  const d = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const rnd = Array.from(crypto.randomBytes(6), (b) => ALPHABET[b % ALPHABET.length]).join("");
  return `LLX-${d}-${rnd}`;
}

const shape = (o: OrderRow, items: ItemRow[]) => ({
  id: o.id,
  orderNumber: o.order_number,
  status: o.status,
  paymentStatus: o.payment_status,
  subtotal: o.subtotal_inr,
  shipping: o.shipping_inr,
  total: o.total_inr,
  shippingAddress: o.shipping_address,
  createdAt: o.created_at,
  items: items.filter((i) => i.order_id === o.id).map((i) => ({
    slug: i.product_slug, name: i.name, colour: i.colour, size: i.size || undefined, qty: i.qty, unitPrice: i.unit_price_inr,
  })),
});

export async function hydrate(rows: OrderRow[], db?: Queryable) {
  if (!rows.length) return [];
  const items = (await query<ItemRow>("SELECT * FROM order_items WHERE order_id = ANY($1) ORDER BY id", [rows.map((r) => r.id)], db)).rows;
  return rows.map((o) => shape(o, items));
}

export async function getOrderRow(id: string, userId: string | null, db?: Queryable) {
  const { rows } = await query<OrderRow>(
    `SELECT * FROM orders WHERE id = $1 ${userId ? "AND user_id = $2" : ""}`,
    userId ? [id, userId] : [id],
    db,
  );
  return rows[0];
}

export function shippingFor(subtotal: number): number {
  const e = env();
  return subtotal >= e.SHIPPING_FREE_THRESHOLD_INR ? 0 : e.SHIPPING_FLAT_INR;
}

/**
 * Turns the user's server-side bag into an order inside one transaction. Prices come from the
 * database (never from the client), stock is decremented atomically, and the bag is cleared.
 */
export async function placeOrder(userId: string, address: Address, idempotencyKey: string | undefined) {
  const result = await placeOrderTx(userId, address, idempotencyKey);
  if (!result.replay) invalidateCatalog(); // stock just went down
  return result;
}

async function placeOrderTx(userId: string, address: Address, idempotencyKey: string | undefined) {
  return withTx(async (db: PoolClient) => {
    if (idempotencyKey) {
      const prior = (await db.query<OrderRow>("SELECT * FROM orders WHERE user_id = $1 AND idempotency_key = $2", [userId, idempotencyKey])).rows[0];
      if (prior) return { replay: true, order: (await hydrate([prior], db))[0]! };
    }

    const lines = (await db.query<{ product_slug: string; colour: string; size: string; qty: number; name: string; price_inr: number; availability: string }>(
      `SELECT c.product_slug, c.colour, c.size, c.qty, p.name, p.price_inr, p.availability
         FROM cart_items c JOIN products p ON p.slug = c.product_slug
        WHERE c.user_id = $1 AND p.active
        ORDER BY c.product_slug, c.colour, c.size`,
      [userId],
    )).rows;
    if (!lines.length) throw badRequest("Your bag is empty");
    // Inactive and coming-soon pieces stay in a bag but cannot be ordered, whatever their stock count.
    const blocked = lines.find((l) => l.availability !== "active");
    if (blocked) throw conflict(`"${blocked.name}" is not available to order right now. Remove it from your bag to continue.`, "unavailable");

    // Decrement per product in slug order (consistent lock order → no deadlocks); the WHERE guard prevents overselling.
    const perProduct = new Map<string, number>();
    for (const l of lines) perProduct.set(l.product_slug, (perProduct.get(l.product_slug) ?? 0) + l.qty);
    const sold: { slug: string; qty: number; after: number }[] = [];
    for (const [slug, qty] of perProduct) {
      const r = await db.query<{ stock_qty: number }>(
        "UPDATE products SET stock_qty = stock_qty - $2, updated_at = now() WHERE slug = $1 AND stock_qty >= $2 RETURNING stock_qty", [slug, qty]);
      if (!r.rowCount) throw conflict(`"${lines.find((l) => l.product_slug === slug)!.name}" no longer has enough stock`, "out_of_stock");
      sold.push({ slug, qty, after: r.rows[0]!.stock_qty });
    }

    const subtotal = lines.reduce((a, l) => a + l.price_inr * l.qty, 0);
    const shipping = shippingFor(subtotal);
    const order = (await db.query<OrderRow>(
      `INSERT INTO orders (order_number, user_id, subtotal_inr, shipping_inr, total_inr, shipping_address, idempotency_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [orderNumber(), userId, subtotal, shipping, subtotal + shipping, JSON.stringify(address), idempotencyKey ?? null],
    )).rows[0]!;
    for (const l of lines) {
      await db.query(
        "INSERT INTO order_items (order_id, product_slug, name, colour, size, qty, unit_price_inr) VALUES ($1,$2,$3,$4,$5,$6,$7)",
        [order.id, l.product_slug, l.name, l.colour, l.size, l.qty, l.price_inr],
      );
    }
    for (const s of sold) await logMovement(db, { slug: s.slug, delta: -s.qty, qtyAfter: s.after, reason: "sale", orderId: order.id, userId });
    await db.query("DELETE FROM cart_items WHERE user_id = $1", [userId]);
    return { replay: false, order: (await hydrate([order], db))[0]! };
  });
}

/** Sets status (and restocks on cancel). `userId` restricts to the owner; null = admin. */
export async function changeStatus(id: string, to: OrderStatus, opts: { userId: string | null }) {
  const order = await changeStatusTx(id, to, opts);
  if (to === "cancelled") invalidateCatalog(); // cancelling returns stock
  return order;
}

async function changeStatusTx(id: string, to: OrderStatus, opts: { userId: string | null }) {
  return withTx(async (db) => {
    const o = (await db.query<OrderRow>(`SELECT * FROM orders WHERE id = $1 ${opts.userId ? "AND user_id = $2" : ""} FOR UPDATE`, opts.userId ? [id, opts.userId] : [id])).rows[0];
    if (!o) throw notFound("Order not found");
    if (o.status === to) return (await hydrate([o], db))[0]!;
    if (!TRANSITIONS[o.status].includes(to)) throw conflict(`Cannot change an order from ${o.status} to ${to}`, "invalid_transition");
    if (to === "cancelled") {
      const back = await db.query<{ slug: string; qty: number; stock_qty: number }>(
        `UPDATE products p SET stock_qty = p.stock_qty + s.qty, updated_at = now()
           FROM (SELECT product_slug, sum(qty)::int AS qty FROM order_items WHERE order_id = $1 GROUP BY product_slug) s
          WHERE p.slug = s.product_slug
        RETURNING p.slug, s.qty, p.stock_qty`,
        [id],
      );
      for (const r of back.rows) await logMovement(db, { slug: r.slug, delta: r.qty, qtyAfter: r.stock_qty, reason: "order_cancelled", orderId: id, userId: opts.userId });
    }
    const updated = (await db.query<OrderRow>("UPDATE orders SET status = $2, updated_at = now() WHERE id = $1 RETURNING *", [id, to])).rows[0]!;
    return (await hydrate([updated], db))[0]!;
  });
}
