import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp, { type OutputInfo } from "sharp";
import { env } from "../config/env.js";
import { cleanHaze, type Raw } from "../lib/photo-haze.js";
import { closePool, getPool } from "./pool.js";

/**
 * Imports the photographed catalogue: optimises each photo for the web, creates or updates the products, records
 * opening stock, and registers every photo in the media library.
 *
 *   npm run products:import                 import everything (re-runnable)
 *   npm run products:import -- --dry-run    check the data and photo files, change nothing
 *   npm run products:import -- --skip-images   only the database rows (photos already processed)
 *   npm run products:import -- --force-images  re-process photos that already exist
 *   npm run products:import -- --prune      also delete image files in MEDIA_DIR that no product or library entry uses any more
 *   npm run products:import -- --overwrite-details  also reset names/descriptions/tags/colours from the data file
 *
 * Prices, stock levels and the active flag of products that already exist are NEVER overwritten: those belong to
 * the admin console. Data: server/data/catalogue/*.json. Photos: PRODUCT_PHOTOS_DIR (default below).
 */
const PHOTOS_DIR = process.env["PRODUCT_PHOTOS_DIR"] ?? "D:\\Leather Lux India\\DSLR Images\\New Products";
const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../data/catalogue");
const flags = new Set(process.argv.slice(2).filter((a) => a.startsWith("--")));

type Rect = [number, number, number, number]; // x0, y0, x1, y1 as fractions of the frame
/** `clean`: whiten the pale film the cut-out left behind (see lib/photo-haze.ts); the number is the brightness limit, 170 unless the film is darker. */
type Shot = { file: string; n: number; label: string; md5: string; crop?: Rect; erase?: Rect[]; clean?: number };
type Item = {
  sku: string; slug: string; name: string; type: string; gender: string; colours: string[]; priceInr: number; material: string; tagline: string;
  description: string; tags: string[]; sizes: string[] | null; dimensions: string; stockQty: number; reorderLevel: number; active: boolean;
  needsReview: boolean; isNew: boolean; gift: boolean; bestseller: boolean; sourceFolder: string; images: Shot[];
};
type Media = { n: number; file: string; md5: string; status: "used" | "spare" | "rejected" | "duplicate"; note: string; folders: string[] };

const products: Item[] = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "products.json"), "utf8"));
const media: Media[] = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "media.json"), "utf8"));
const mediaRoot = env().mediaDir;

// ── image processing ─────────────────────────────────────────────────────────────────────────
// Every photo becomes a 4:5 white canvas with the product centred (so cards and galleries line up and nothing is cropped).
const SIZES = { lg: { w: 1200, h: 1500, q: 82 }, sm: { w: 480, h: 600, q: 76 } } as const;

const rawOf = (r: { data: Buffer; info: OutputInfo }): Raw => ({ data: r.data, width: r.info.width, height: r.info.height, channels: r.info.channels as 3 | 4 });
const fromRaw = (r: Raw) => sharp(r.data, { raw: { width: r.width, height: r.height, channels: r.channels } });

/** Decodes once, already shrunk (JPEG shrink-on-load keeps the 30-megapixel originals cheap) and upright. */
async function decode(input: string, crop: Shot["crop"], erase: Shot["erase"], clean: Shot["clean"]): Promise<Raw> {
  let img = rawOf(await sharp(input, { failOn: "none" }).rotate().resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" }).raw().toBuffer({ resolveWithObject: true }));
  if (erase?.length) {
    const white = (w: number, h: number) => ({ create: { width: Math.max(1, w), height: Math.max(1, h), channels: 3 as const, background: "#ffffff" } });
    img = rawOf(await fromRaw(img).composite(erase.map(([x0, y0, x1, y1]) => ({
      input: white(Math.round((x1 - x0) * img.width), Math.round((y1 - y0) * img.height)), left: Math.round(x0 * img.width), top: Math.round(y0 * img.height),
    }))).raw().toBuffer({ resolveWithObject: true }));
  }
  if (crop) {
    const [x0, y0, x1, y1] = crop;
    const left = Math.max(0, Math.round(x0 * img.width)), top = Math.max(0, Math.round(y0 * img.height));
    const width = Math.min(img.width - left, Math.round((x1 - x0) * img.width)), height = Math.min(img.height - top, Math.round((y1 - y0) * img.height));
    img = rawOf(await fromRaw(img).extract({ left, top, width, height }).raw().toBuffer({ resolveWithObject: true }));
  }
  return clean ? cleanHaze(img, clean) : img;
}

/**
 * Where a photo is stored. The name holds the camera number and a hash of the source photo, plus a short tag for how it was edited
 * (crop, erase, clean). Browsers keep these files for a year, so changing an edit must change the name: they then fetch the new version.
 */
const photoRel = (dir: string, s: Pick<Shot, "n" | "md5" | "crop" | "erase" | "clean">) => {
  const edits = s.crop || s.erase?.length || s.clean ? `-${crypto.createHash("sha1").update(JSON.stringify([s.crop ?? null, s.erase ?? null, s.clean ?? null])).digest("hex").slice(0, 6)}` : "";
  return `${dir}/${s.n}-${s.md5}${edits}`;
};

/** Trims the studio backdrop, then centres the product on a white canvas of the exact size. */
async function canvas(img: Raw, size: { w: number; h: number }): Promise<Raw> {
  let subject = img;
  try { subject = rawOf(await fromRaw(img).trim({ background: "#ffffff", threshold: 14 }).raw().toBuffer({ resolveWithObject: true })); } catch { /* nothing to trim */ }
  const fitted = rawOf(await fromRaw(subject).resize({ width: Math.round(size.w * 0.9), height: Math.round(size.h * 0.9), fit: "inside" }).raw().toBuffer({ resolveWithObject: true }));
  const padX = size.w - fitted.width, padY = size.h - fitted.height;
  return rawOf(await fromRaw(fitted).extend({
    left: Math.floor(padX / 2), right: Math.ceil(padX / 2), top: Math.floor(padY / 2), bottom: Math.ceil(padY / 2), background: "#ffffff",
  }).raw().toBuffer({ resolveWithObject: true }));
}

/** Written to a temporary name first, so an interrupted run can never leave a half-written image that looks finished. */
function writeAtomic(file: string, data: Buffer) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

async function makeImage(shot: Shot, rel: string): Promise<{ web: string; thumb: string; made: boolean }> {
  const web = `/media/${rel}.webp`, thumb = `/media/${rel}-sm.webp`;
  const outLg = path.join(mediaRoot, `${rel}.webp`), outSm = path.join(mediaRoot, `${rel}-sm.webp`);
  if (!flags.has("--force-images") && fs.existsSync(outLg) && fs.existsSync(outSm)) return { web, thumb, made: false };
  fs.mkdirSync(path.dirname(outLg), { recursive: true });
  const lg = await canvas(await decode(path.join(PHOTOS_DIR, shot.file), shot.crop, shot.erase, shot.clean), SIZES.lg);
  writeAtomic(outLg, await fromRaw(lg).webp({ quality: SIZES.lg.q, effort: 4 }).toBuffer());
  writeAtomic(outSm, await fromRaw(lg).resize(SIZES.sm.w, SIZES.sm.h).webp({ quality: SIZES.sm.q, effort: 4 }).toBuffer());
  return { web, thumb, made: true };
}

/** Runs `fn` over `items` with at most `limit` in flight. */
async function pool<T>(items: T[], limit: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: limit }, async () => { while (i < items.length) await fn(items[i++]!); }));
}

// ── main ─────────────────────────────────────────────────────────────────────────────────────
async function main() {
  const missing: string[] = [];
  const allShots = [...products.flatMap((p) => p.images), ...media.filter((m) => m.status === "spare").map((m) => ({ file: m.file } as Shot))];
  if (!flags.has("--skip-images")) for (const s of allShots) if (!fs.existsSync(path.join(PHOTOS_DIR, s.file))) missing.push(s.file);
  if (missing.length) {
    console.error(`${missing.length} photo file(s) not found under ${PHOTOS_DIR}, e.g. ${missing.slice(0, 3).join(", ")}\nSet PRODUCT_PHOTOS_DIR to the folder that holds them.`);
    process.exitCode = 1;
    return;
  }
  const dupSku = products.map((p) => p.sku).filter((s, i, a) => a.indexOf(s) !== i);
  if (dupSku.length) throw new Error(`duplicate SKUs in products.json: ${dupSku.join(", ")}`);
  console.log(`${products.length} products, ${media.length} photos, source ${PHOTOS_DIR}`);
  if (flags.has("--dry-run")) { console.log("dry run: all photo files found, data valid. Nothing changed."); return; }

  // 1. photos -> optimised files. Every photo that belongs on a product, or waits in the library, has a fixed place.
  const jobs: { shot: Shot; rel: string; key: number }[] = [];
  for (const p of products) for (const s of p.images) jobs.push({ shot: s, rel: photoRel(`products/${p.slug}`, s), key: s.n });
  for (const m of media.filter((x) => x.status === "spare")) jobs.push({ shot: { file: m.file, n: m.n, label: "", md5: m.md5 }, rel: photoRel("library", { n: m.n, md5: m.md5 }), key: m.n });
  const webPaths = new Map(jobs.map((j) => [j.key, { web: `/media/${j.rel}.webp`, thumb: `/media/${j.rel}-sm.webp` }]));
  let made = 0, reused = 0;
  if (!flags.has("--skip-images")) {
    let done = 0;
    await pool(jobs, 4, async (j) => {
      (await makeImage(j.shot, j.rel)).made ? made++ : reused++;
      if (++done % 25 === 0 || done === jobs.length) process.stdout.write(`\r  photos ${done}/${jobs.length}`);
    });
    process.stdout.write("\n");
  }
  if (flags.has("--prune")) {
    // Delete image files that no product or library entry points to any more (replaced edits, photos taken off a product).
    const keep = new Set(jobs.flatMap((j) => [`${j.rel}.webp`, `${j.rel}-sm.webp`]));
    let removed = 0;
    for (const dir of ["products", "library"]) {
      const walk = (d: string) => {
        if (!fs.existsSync(d)) return;
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          const full = path.join(d, e.name);
          if (e.isDirectory()) walk(full);
          else if (!keep.has(path.relative(mediaRoot, full).split(path.sep).join("/"))) { fs.rmSync(full); removed++; }
        }
      };
      walk(path.join(mediaRoot, dir));
    }
    console.log(`pruned ${removed} unreferenced image file(s)`);
  }

  // 2. products
  const pg = getPool();
  const client = await pg.connect();
  let inserted = 0, updated = 0;
  try {
    await client.query("BEGIN");
    let rank = 100;
    for (const p of products) {
      const images = p.images.map((s) => webPaths.get(s.n)!.web);
      const labels = p.images.map((s) => s.label);
      const r = await client.query<{ inserted: boolean }>(
        `INSERT INTO products (slug, name, type, gender, price_inr, colours, images, image_labels, is_new, bestseller, gift, stock_qty, tagline, material,
                               dimensions, sizes, rank, active, sku, description, tags, reorder_level, needs_review, source_folder)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
         ON CONFLICT (slug) DO UPDATE SET
           images = EXCLUDED.images, image_labels = EXCLUDED.image_labels, source_folder = EXCLUDED.source_folder,
           sku = COALESCE(products.sku, EXCLUDED.sku), updated_at = now()
           ${flags.has("--overwrite-details")
             ? `, name = EXCLUDED.name, type = EXCLUDED.type, gender = EXCLUDED.gender, colours = EXCLUDED.colours, tagline = EXCLUDED.tagline,
                  material = EXCLUDED.material, dimensions = EXCLUDED.dimensions, sizes = EXCLUDED.sizes, description = EXCLUDED.description,
                  tags = EXCLUDED.tags, is_new = EXCLUDED.is_new, gift = EXCLUDED.gift`
             : ""}
         RETURNING (xmax = 0) AS inserted`,
        [p.slug, p.name, p.type, p.gender, p.priceInr, p.colours, images, labels, p.isNew, p.bestseller, p.gift, p.stockQty, p.tagline, p.material,
          p.dimensions, p.sizes, rank++, p.active, p.sku, p.description, p.tags, p.reorderLevel, p.needsReview, p.sourceFolder],
      );
      if (r.rows[0]!.inserted) {
        inserted++;
        await client.query(
          "INSERT INTO inventory_movements (product_slug, delta, qty_after, reason, note) VALUES ($1,$2,$2,'opening_stock','Placeholder opening stock from the catalogue import: replace with a physical count')",
          [p.slug, p.stockQty],
        );
      } else updated++;
    }

    // Samples that predate SKUs get one too, so every product has an identifier.
    const { rows: bare } = await client.query<{ slug: string }>("SELECT slug FROM products WHERE sku IS NULL ORDER BY rank, slug");
    for (const [i, b] of bare.entries()) await client.query("UPDATE products SET sku = $2 WHERE slug = $1", [b.slug, `LLI-SMP-${String(i + 1).padStart(3, "0")}`]);

    // 3. media library
    const slugOf = new Map<number, string>();
    for (const p of products) for (const s of p.images) slugOf.set(s.n, p.slug);
    for (const m of media) {
      const w = (m.status === "used" || m.status === "spare") ? webPaths.get(m.n) : undefined;
      await client.query(
        `INSERT INTO media_assets (camera_no, source_file, content_hash, status, note, product_slug, web_path, thumb_path)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (source_file) DO UPDATE SET status = EXCLUDED.status, note = EXCLUDED.note, product_slug = EXCLUDED.product_slug,
           web_path = EXCLUDED.web_path, thumb_path = EXCLUDED.thumb_path, updated_at = now()`,
        [m.n, m.file, m.md5, m.status, m.note, m.status === "used" ? (slugOf.get(m.n) ?? null) : null, w?.web ?? null, w?.thumb ?? null],
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
  console.log(`products: ${inserted} added, ${updated} updated (prices, stock and visibility untouched) | photos: ${made} processed, ${reused} already done`);
  console.log("If the API is running, clear its cache so the new products show immediately: POST /api/admin/cache/purge (or wait for the cache to expire).");
}

main()
  .catch((err) => { console.error(`Import failed: ${(err as Error).message}`); process.exitCode = 1; })
  .finally(closePool);
