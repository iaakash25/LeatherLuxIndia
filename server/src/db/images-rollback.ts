import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { closePool, getPool } from "./pool.js";

/**
 * Rollback points for the product photos. The photo FILES are never overwritten (a changed photo gets a new file name, see
 * import-products.ts), so what has to be remembered is which file each product and library entry pointed at. This saves exactly that
 * as a plain SQL script, and runs it again to go back.
 *
 *   npm run images:rollback -- save <name>                save the current photo paths to data/rollback/<name>/restore-images.sql
 *   npm run images:rollback -- restore <name> [--dry-run]  point every product back at the photos saved under <name>
 *
 * `--dry-run` runs the whole script and then undoes it, reporting how many rows it matched. Prices, stock, names and every other
 * column are left alone. The API keeps the catalogue in memory for up to a minute, so a restore shows on the site within that time.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../data/rollback");
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
const arr = (a: string[]) => (a.length ? `ARRAY[${a.map(lit).join(", ")}]::text[]` : "'{}'::text[]");
const nullable = (s: string | null) => (s === null ? "NULL" : lit(s));

const [, , cmd, name, ...rest] = process.argv;
const dir = name ? path.join(ROOT, name) : "";
const file = path.join(dir, "restore-images.sql");

async function save() {
  const pool = getPool();
  const products = (await pool.query<{ slug: string; images: string[]; image_labels: string[] }>("SELECT slug, images, image_labels FROM products ORDER BY slug")).rows;
  const media = (await pool.query<{ source_file: string; web_path: string | null; thumb_path: string | null }>("SELECT source_file, web_path, thumb_path FROM media_assets ORDER BY source_file")).rows;
  const lines = [
    `-- Rollback point "${name}": the photo paths of ${products.length} products and ${media.length} library photos, saved ${new Date().toISOString()}.`,
    "-- Run with: npm run images:rollback -- restore " + name + "   (add --dry-run first to see what it would do)",
    "-- Only the photo columns are touched: images and image_labels of products, web_path and thumb_path of media_assets.",
    "BEGIN;",
    ...products.map((p) => `UPDATE products SET images = ${arr(p.images)}, image_labels = ${arr(p.image_labels)}, updated_at = now() WHERE slug = ${lit(p.slug)};`),
    ...media.map((m) => `UPDATE media_assets SET web_path = ${nullable(m.web_path)}, thumb_path = ${nullable(m.thumb_path)}, updated_at = now() WHERE source_file = ${lit(m.source_file)};`),
    "COMMIT;",
    "",
  ];
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, lines.join("\n"), "utf8");
  console.log(`Saved ${products.length} products and ${media.length} library photos to ${path.relative(process.cwd(), file)}`);
}

async function restore() {
  if (!fs.existsSync(file)) throw new Error(`No rollback point named "${name}" (looked for ${file})`);
  const statements = fs.readFileSync(file, "utf8").split("\n").filter((l) => l.startsWith("UPDATE "));
  const client = await getPool().connect();
  let matched = 0, missed = 0;
  try {
    await client.query("BEGIN");
    for (const sql of statements) {
      const r = await client.query(sql);
      if (r.rowCount) matched++; else missed++;
    }
    await client.query(rest.includes("--dry-run") ? "ROLLBACK" : "COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
  console.log(`${rest.includes("--dry-run") ? "Dry run (nothing changed): " : "Restored: "}${matched} rows matched, ${missed} not found (rows added since the rollback point are not touched).`);
}

try {
  if (!name || !/^[a-z0-9][a-z0-9._-]*$/i.test(name) || (cmd !== "save" && cmd !== "restore")) {
    throw new Error("Usage: npm run images:rollback -- save <name>   |   restore <name> [--dry-run]");
  }
  await (cmd === "save" ? save() : restore());
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 1;
} finally {
  await closePool();
}
