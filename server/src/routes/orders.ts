import { Router } from "express";
import { z } from "zod";
import { env } from "../config/env.js";
import { query } from "../db/pool.js";
import { AppError, notFound } from "../lib/errors.js";
import { addressSchema, changeStatus, getOrderRow, hydrate, placeOrder } from "../lib/orders.js";
import { audit } from "../lib/session.js";
import { me, requireAuth } from "../middleware/auth.js";

const idempotencyKey = z.string().regex(/^[A-Za-z0-9_-]{8,100}$/);
type Row = Parameters<typeof hydrate>[0][number];

export const ordersRouter = Router();
ordersRouter.use(requireAuth);

/** Checkout: converts the server-side bag into an order. Payment is not collected here (see README). */
ordersRouter.post("/", async (req, res) => {
  // Enforced here, not only in the storefront: before launch nobody can order by calling the API directly either. The bag stays as it is.
  if (!env().ORDERS_OPEN) throw new AppError(403, "orders_closed", "Orders are not open yet. Your bag is saved, and you can place your order as soon as we open.");
  const { shippingAddress } = z.object({ shippingAddress: addressSchema }).parse(req.body);
  const key = req.get("idempotency-key");
  const { replay, order } = await placeOrder(me(req).id, shippingAddress, key === undefined ? undefined : idempotencyKey.parse(key));
  if (!replay) await audit(req, "order_placed", me(req).id, { orderId: order.id });
  res.status(replay ? 200 : 201).json({ order });
});

ordersRouter.get("/", async (req, res) => {
  const limit = z.coerce.number().int().min(1).max(50).default(20).parse(req.query.limit);
  const offset = z.coerce.number().int().min(0).max(10_000).default(0).parse(req.query.offset);
  const { rows } = await query<Row>("SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3", [me(req).id, limit, offset]);
  res.json({ orders: await hydrate(rows) });
});

ordersRouter.get("/:id", async (req, res) => {
  const row = await getOrderRow(z.uuid().parse(req.params.id), me(req).id);
  if (!row) throw notFound("Order not found");
  res.json({ order: (await hydrate([row]))[0] });
});

/** Customers may cancel until the order ships; stock is returned. */
ordersRouter.post("/:id/cancel", async (req, res) => {
  const order = await changeStatus(z.uuid().parse(req.params.id), "cancelled", { userId: me(req).id });
  await audit(req, "order_cancelled", me(req).id, { orderId: order.id });
  res.json({ order });
});
