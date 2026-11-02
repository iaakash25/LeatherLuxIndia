import { query, type Queryable } from "../db/pool.js";
import { badRequest } from "./errors.js";
import { stockStatus, thumbOf, type ProductRow } from "./catalog.js";
import { shippingFor } from "./orders.js";

export const MAX_QTY = 10;
export const MAX_CART_LINES = 50;

type CartRow = { id: string; qty: number; colour: string; size: string } & ProductRow;

export async function loadCart(userId: string, db?: Queryable) {
  const { rows } = await query<CartRow>(
    `SELECT c.id, c.qty, c.colour, c.size, p.*
       FROM cart_items c JOIN products p ON p.slug = c.product_slug
      WHERE c.user_id = $1 AND p.active
      ORDER BY c.created_at, c.id`,
    [userId],
    db,
  );
  const items = rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    colour: r.colour,
    size: r.size || undefined,
    qty: r.qty,
    unitPrice: r.price_inr,
    lineTotal: r.price_inr * r.qty,
    image: r.images[0] ?? null,
    thumb: r.images[0] ? thumbOf(r.images[0]) : null,
    stock: r.availability === "active" ? stockStatus(r.stock_qty, r.reorder_level) : "out",
    available: r.availability === "active" && r.stock_qty >= r.qty,
  }));
  const count = items.reduce((a, i) => a + i.qty, 0);
  const subtotal = items.reduce((a, i) => a + i.lineTotal, 0);
  // Same rule placeOrder applies, so the bag can show exactly what checkout will charge.
  const shipping = items.length ? shippingFor(subtotal) : 0;
  return { items, count, subtotal, shipping, total: subtotal + shipping };
}

/** Checks colour/size against the product and returns the normalised size key ('' when not applicable). */
export function validateVariant(p: Pick<ProductRow, "colours" | "sizes" | "stock_qty">, colour: string, size: string | undefined): string {
  if (!p.colours.includes(colour)) throw badRequest(`Colour "${colour}" is not available for this product`);
  if (p.sizes?.length) {
    if (!size || !p.sizes.includes(size)) throw badRequest("A valid size is required for this product");
    return size;
  }
  if (size) throw badRequest("This product does not have sizes");
  return "";
}

/** Upsert that adds to an existing line, clamped to MAX_QTY. Respects the per-user line cap. */
export async function addCartItem(userId: string, slug: string, colour: string, size: string | undefined, qty: number, db?: Queryable) {
  const p = (await query<ProductRow>("SELECT * FROM products WHERE slug = $1 AND active", [slug], db)).rows[0];
  if (!p) throw badRequest("Unknown product");
  if (p.availability === "coming_soon") throw badRequest("This piece is coming soon and cannot be ordered yet");
  if (p.availability !== "active" || p.stock_qty <= 0) throw badRequest("This piece is currently unavailable");
  const sizeKey = validateVariant(p, colour, size);
  const { rows } = await query<{ n: string }>("SELECT count(*) AS n FROM cart_items WHERE user_id = $1", [userId], db);
  const exists = (await query("SELECT 1 FROM cart_items WHERE user_id=$1 AND product_slug=$2 AND colour=$3 AND size=$4", [userId, slug, colour, sizeKey], db)).rowCount;
  if (!exists && Number(rows[0]!.n) >= MAX_CART_LINES) throw badRequest("Your bag is full");
  await query(
    `INSERT INTO cart_items (user_id, product_slug, colour, size, qty) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (user_id, product_slug, colour, size)
     DO UPDATE SET qty = LEAST($6, cart_items.qty + EXCLUDED.qty), updated_at = now()`,
    [userId, slug, colour, sizeKey, Math.min(qty, MAX_QTY), MAX_QTY],
    db,
  );
}
