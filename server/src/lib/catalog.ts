import { query } from "../db/pool.js";

export const PRICE_MIN = 0; // the cheapest pieces (key loops) sit just under ₹500, so the filter must start at zero
export const PRICE_MAX = 25000;

export type ProductRow = {
  slug: string; name: string; type: string; gender: "women" | "men" | "unisex"; price_inr: number;
  colours: string[]; images: string[]; is_new: boolean; bestseller: boolean; gift: boolean;
  stock_qty: number; tagline: string; material: string; dimensions: string; sizes: string[] | null; rank: number;
  sku: string | null; description: string; tags: string[]; image_labels: string[]; cost_inr: number | null;
  reorder_level: number; needs_review: boolean; source_folder: string | null; active: boolean; created_at: Date; updated_at: Date;
};

/** "low" at or below the product's reorder level, which the shop sets per product (default 3). */
export const stockStatus = (qty: number, reorderLevel = 3): "in" | "low" | "out" => (qty <= 0 ? "out" : qty <= reorderLevel ? "low" : "in");

/**
 * An entry of `products.images` is either a storefront asset key (the original sample products) or a path under /media/
 * (photographed products), which also has a small version next to it for cards and thumbnails.
 */
export const thumbOf = (image: string) => (image.startsWith("/media/") ? image.replace(/\.webp$/, "-sm.webp") : image);

/** Shape consumed by the storefront (mirrors `Product` in src/lib/catalog.ts). */
export function toProduct(p: ProductRow) {
  return {
    slug: p.slug, sku: p.sku ?? undefined, name: p.name, type: p.type, gender: p.gender, price: p.price_inr,
    colours: p.colours, images: p.images, thumbs: p.images.map(thumbOf), imageLabels: p.image_labels,
    isNew: p.is_new, bestseller: p.bestseller, gift: p.gift,
    stock: stockStatus(p.stock_qty, p.reorder_level), tagline: p.tagline, material: p.material, dimensions: p.dimensions,
    description: p.description, tags: p.tags, sizes: p.sizes ?? undefined, rank: p.rank,
  };
}

const BAG_TYPES = ["Handbags", "Totes", "Satchels", "Sling Bags", "Clutches", "Crossbody", "Backpacks", "Laptop & Work", "Travel"];
const SLG_TYPES = ["Wallets", "Card Cases", "Belts", "Pouches", "Key Accessories", "ID Card Holders", "Passport Holders", "Eyewear Cases", "Mobile Holders", "Desk Accessories"];

/** Static collection definitions; `where` is a trusted SQL fragment using $-placeholders from `params`. */
export type CollectionDef = { slug: string; title: string; eyebrow: string; intro: string; image: string; where: string; params: unknown[] };

export const COLLECTIONS: CollectionDef[] = [
  { slug: "all", title: "The Collection", eyebrow: "Everything", intro: "Every piece in the current house collection, from key loops to weekenders.", image: "hero", where: "TRUE", params: [] },
  { slug: "new-in", title: "New In", eyebrow: "Autumn / Winter", intro: "Recent arrivals: sculpted handles, softer totes and a new weekender.", image: "hero", where: "is_new", params: [] },
  { slug: "women", title: "Women", eyebrow: "Womenswear", intro: "Top-handles, shoulder bags, totes and small leather goods.", image: "women", where: "gender <> 'men'", params: [] },
  { slug: "men", title: "Men", eyebrow: "Menswear", intro: "Briefcases, backpacks, belts and wallets with quiet hardware.", image: "men", where: "gender <> 'women'", params: [] },
  { slug: "bags", title: "Bags", eyebrow: "Carry", intro: "From the mini to the weekender — shapes for every distance.", image: "women", where: "type = ANY(@)", params: [BAG_TYPES] },
  { slug: "small-leather-goods", title: "Small Leather Goods", eyebrow: "Everyday objects", intro: "Wallets, card cases, belts and pouches. Considered gifts start at ₹490.", image: "slg", where: "type = ANY(@)", params: [SLG_TYPES] },
  { slug: "work-travel", title: "Work & Travel", eyebrow: "In transit", intro: "Laptop bags, backpacks, duffles and wash bags built for movement.", image: "travel", where: "type = ANY(@)", params: [["Laptop & Work", "Travel", "Backpacks"]] },
  { slug: "gifts", title: "The Gift Edit", eyebrow: "Under ₹6,000", intro: "Small objects, well made. Pieces chosen for giving.", image: "slg", where: "gift", params: [] },
];

export const collectionMeta = ({ slug, title, eyebrow, intro, image }: CollectionDef) => ({ slug, title, eyebrow, intro, image });

export type SortKey = "featured" | "new" | "price-asc" | "price-desc";
export type ListOptions = {
  collection?: CollectionDef | undefined; q?: string | undefined; types: string[]; colours: string[];
  min: number; max: number; inStock: boolean; sort: SortKey; limit: number; offset: number;
};

const ORDER: Record<SortKey, string> = {
  featured: "rank ASC",
  new: "is_new DESC, rank ASC",
  "price-asc": "price_inr ASC, rank ASC",
  "price-desc": "price_inr DESC, rank ASC",
};
const escapeLike = (s: string) => s.replace(/[\\%_]/g, "\\$&");

/** Builds a fully parameterised catalogue query. Only trusted fragments are concatenated into SQL text. */
export async function listProducts(o: ListOptions) {
  const params: unknown[] = [];
  const add = (v: unknown) => { params.push(v); return `$${params.length}`; };
  const where: string[] = ["active"];

  if (o.collection) {
    const base = params.length;
    where.push(`(${o.collection.where.replace("@", () => `$${base + 1}`)})`);
    params.push(...o.collection.params);
  }
  if (o.types.length) where.push(`type = ANY(${add(o.types)})`);
  if (o.colours.length) where.push(`colours && ${add(o.colours)}::text[]`);
  where.push(`price_inr >= ${add(o.min)}`);
  if (o.max < PRICE_MAX) where.push(`price_inr <= ${add(o.max)}`); // the UI's top of range means "no upper limit"
  if (o.inStock) where.push("stock_qty > 0");
  for (const w of (o.q ?? "").toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8)) {
    where.push(`lower(name || ' ' || type || ' ' || gender || ' ' || array_to_string(colours, ' ') || ' ' || tagline || ' ' || array_to_string(tags, ' ') || ' ' || coalesce(sku, '')) LIKE ${add(`%${escapeLike(w)}%`)}`);
  }

  const clause = where.join(" AND ");
  const total = (await query<{ n: string }>(`SELECT count(*) AS n FROM products WHERE ${clause}`, params)).rows[0]!.n;
  const rows = (await query<ProductRow>(
    `SELECT * FROM products WHERE ${clause} ORDER BY ${ORDER[o.sort]} LIMIT ${add(o.limit)} OFFSET ${add(o.offset)}`,
    params,
  )).rows;
  return { total: Number(total), products: rows.map(toProduct) };
}
