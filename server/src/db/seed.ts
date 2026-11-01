import path from "node:path";
import { fileURLToPath } from "node:url";
import { closePool, getPool } from "./pool.js";
import { SEED_PRODUCTS } from "./seed-data.js";
import { logger } from "../lib/logger.js";

/** Upserts the catalogue. Re-running never resets live stock levels or the active flag. */
export async function seed(): Promise<number> {
  const pool = getPool();
  for (const p of SEED_PRODUCTS) {
    await pool.query(
      `INSERT INTO products (slug, name, type, gender, price_inr, colours, images, is_new, bestseller, gift,
                             stock_qty, tagline, material, dimensions, sizes, rank)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       ON CONFLICT (slug) DO UPDATE SET
         name = EXCLUDED.name, type = EXCLUDED.type, gender = EXCLUDED.gender, price_inr = EXCLUDED.price_inr,
         colours = EXCLUDED.colours, images = EXCLUDED.images, is_new = EXCLUDED.is_new,
         bestseller = EXCLUDED.bestseller, gift = EXCLUDED.gift, tagline = EXCLUDED.tagline,
         material = EXCLUDED.material, dimensions = EXCLUDED.dimensions, sizes = EXCLUDED.sizes,
         rank = EXCLUDED.rank, updated_at = now()`,
      [p.slug, p.name, p.type, p.gender, p.priceInr, p.colours, p.images, p.isNew, p.bestseller, p.gift,
        p.stockQty, p.tagline, p.material, p.dimensions, p.sizes, p.rank],
    );
  }
  return SEED_PRODUCTS.length;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  seed()
    .then((n) => logger.info({ products: n }, "catalogue seeded"))
    .catch((err) => { logger.error({ err: err.message }, "seed failed"); process.exitCode = 1; })
    .finally(closePool);
}
