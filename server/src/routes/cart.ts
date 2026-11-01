import { Router } from "express";
import { z } from "zod";
import { query } from "../db/pool.js";
import { MAX_QTY, addCartItem, loadCart } from "../lib/cart.js";
import { notFound } from "../lib/errors.js";
import { me, requireAuth } from "../middleware/auth.js";

const slug = z.string().min(1).max(80).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);
const line = z.object({
  slug,
  colour: z.string().trim().min(1).max(40),
  size: z.string().trim().min(1).max(10).optional(),
  qty: z.number().int().min(1).max(MAX_QTY).default(1),
});

export const cartRouter = Router();
cartRouter.use(requireAuth);

cartRouter.get("/", async (req, res) => {
  res.json(await loadCart(me(req).id));
});

cartRouter.post("/items", async (req, res) => {
  const b = line.parse(req.body);
  await addCartItem(me(req).id, b.slug, b.colour, b.size, b.qty);
  res.status(201).json(await loadCart(me(req).id));
});

/** Merge a guest (localStorage) bag into the signed-in user's bag after login. Invalid lines are skipped. */
cartRouter.post("/merge", async (req, res) => {
  const { items } = z.object({ items: z.array(line).max(50) }).parse(req.body);
  const skipped: string[] = [];
  for (const it of items) {
    try { await addCartItem(me(req).id, it.slug, it.colour, it.size, it.qty); } catch { skipped.push(it.slug); }
  }
  res.json({ ...(await loadCart(me(req).id)), skipped });
});

cartRouter.patch("/items/:id", async (req, res) => {
  const id = z.uuid().parse(req.params.id);
  const { qty } = z.object({ qty: z.number().int().min(1).max(MAX_QTY) }).parse(req.body);
  const r = await query("UPDATE cart_items SET qty = $3, updated_at = now() WHERE id = $1 AND user_id = $2", [id, me(req).id, qty]);
  if (!r.rowCount) throw notFound("Bag item not found");
  res.json(await loadCart(me(req).id));
});

cartRouter.delete("/items/:id", async (req, res) => {
  const id = z.uuid().parse(req.params.id);
  const r = await query("DELETE FROM cart_items WHERE id = $1 AND user_id = $2", [id, me(req).id]);
  if (!r.rowCount) throw notFound("Bag item not found");
  res.json(await loadCart(me(req).id));
});

cartRouter.delete("/", async (req, res) => {
  await query("DELETE FROM cart_items WHERE user_id = $1", [me(req).id]);
  res.json(await loadCart(me(req).id));
});
