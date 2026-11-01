import { Router } from "express";
import { z } from "zod";
import { query } from "../db/pool.js";
import { toProduct, type ProductRow } from "../lib/catalog.js";
import { badRequest } from "../lib/errors.js";
import { me, requireAuth } from "../middleware/auth.js";

const slug = z.string().min(1).max(80).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);
const MAX_WISHLIST = 200;

export const wishlistRouter = Router();
wishlistRouter.use(requireAuth);

async function load(userId: string) {
  const { rows } = await query<ProductRow>(
    `SELECT p.* FROM wishlist_items w JOIN products p ON p.slug = w.product_slug
      WHERE w.user_id = $1 AND p.active ORDER BY w.created_at DESC`,
    [userId],
  );
  return { slugs: rows.map((r) => r.slug), products: rows.map(toProduct) };
}

async function add(userId: string, slugs: string[]) {
  const have = Number((await query<{ n: string }>("SELECT count(*) AS n FROM wishlist_items WHERE user_id = $1", [userId])).rows[0]!.n);
  if (have + slugs.length > MAX_WISHLIST) throw badRequest("Your wishlist is full");
  // Unknown or inactive slugs are silently ignored by the join.
  await query(
    `INSERT INTO wishlist_items (user_id, product_slug)
     SELECT $1, slug FROM products WHERE slug = ANY($2) AND active
     ON CONFLICT DO NOTHING`,
    [userId, slugs],
  );
}

wishlistRouter.get("/", async (req, res) => { res.json(await load(me(req).id)); });

wishlistRouter.put("/:slug", async (req, res) => {
  await add(me(req).id, [slug.parse(req.params.slug)]);
  res.json(await load(me(req).id));
});

wishlistRouter.delete("/:slug", async (req, res) => {
  await query("DELETE FROM wishlist_items WHERE user_id = $1 AND product_slug = $2", [me(req).id, slug.parse(req.params.slug)]);
  res.json(await load(me(req).id));
});

/** Merge a guest (localStorage) wishlist after login. */
wishlistRouter.post("/merge", async (req, res) => {
  const { slugs } = z.object({ slugs: z.array(slug).max(100) }).parse(req.body);
  await add(me(req).id, [...new Set(slugs)]);
  res.json(await load(me(req).id));
});
