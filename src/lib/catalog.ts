import handbag from "@/assets/p-handbag.jpg";
import brief from "@/assets/p-brief.jpg";
import tote from "@/assets/p-tote.jpg";
import wallet from "@/assets/p-wallet.jpg";
import crossbody from "@/assets/p-crossbody.jpg";
import backpack from "@/assets/p-backpack.jpg";
import belt from "@/assets/p-belt.jpg";
import slg from "@/assets/slg.jpg";
import women from "@/assets/women.jpg";
import men from "@/assets/men.jpg";
import travel from "@/assets/travel.jpg";
import texture from "@/assets/texture.jpg";
import hero from "@/assets/hero.jpg";

export const images = { handbag, brief, tote, wallet, crossbody, backpack, belt, slg, women, men, travel, texture, hero };

export type ProductType =
  | "Wallets" | "Card Cases" | "Belts" | "Pouches" | "Key Accessories"
  | "ID Card Holders" | "Passport Holders" | "Eyewear Cases" | "Mobile Holders" | "Desk Accessories"
  | "Handbags" | "Totes" | "Satchels" | "Sling Bags" | "Clutches" | "Crossbody" | "Backpacks" | "Laptop & Work" | "Travel";

export type Colour = { name: string; swatch: string };
export const COLOURS: Record<string, Colour> = {
  Ink: { name: "Ink", swatch: "#171817" },
  Oxblood: { name: "Oxblood", swatch: "#642F3B" },
  Taupe: { name: "Taupe", swatch: "#8A7F72" },
  Cognac: { name: "Cognac", swatch: "#9A5B30" },
  Espresso: { name: "Espresso", swatch: "#3A2A22" },
  Porcelain: { name: "Porcelain", swatch: "#E9E4DA" },
  Tan: { name: "Tan", swatch: "#B8834A" },
  Navy: { name: "Navy", swatch: "#1F2A44" },
  Olive: { name: "Olive", swatch: "#6B6A38" },
  Forest: { name: "Forest", swatch: "#2E4A3C" },
  Hunter: { name: "Hunter", swatch: "#3F5A3A" },
  Slate: { name: "Slate", swatch: "#5B6670" },
};

export type Product = {
  slug: string;
  name: string;
  type: ProductType;
  gender: "women" | "men" | "unisex";
  price: number;
  colours: string[];
  images: string[];
  /** Small versions of `images`, same order, for cards and thumbnails (the same as `images` when there is no smaller one). */
  thumbs?: string[] | undefined;
  /** What each photo shows ("Front", "Open view", …), same order as `images`. */
  imageLabels?: string[] | undefined;
  sku?: string | undefined;
  isNew?: boolean | undefined;
  bestseller?: boolean;
  gift?: boolean;
  stock: "in" | "low" | "out";
  tagline: string;
  /** A paragraph for the product page; empty for the original sample products. */
  description?: string | undefined;
  tags?: string[] | undefined;
  material: string;
  dimensions: string;
  sizes?: string[] | undefined;
  rank: number;
};

/** The small version of a product's `i`-th photo (the full photo when there is no smaller one). */
export const productThumb = (p: Pick<Product, "images" | "thumbs">, i = 0): string => (p.thumbs ?? p.images)[i] ?? p.images[i] ?? p.images[0]!;

const P = (p: Omit<Product, "rank">, i: number): Product => ({ ...p, rank: i });

const RAW: Omit<Product, "rank">[] = [
  { slug: "aria-top-handle", name: "Aria Top-Handle", type: "Handbags", gender: "women", price: 14990, colours: ["Oxblood", "Ink", "Taupe"], images: [handbag, hero, texture], isNew: true, bestseller: true, stock: "in", tagline: "A sculpted top-handle with a brass turn-lock and a detachable strap.", material: "Smooth leather, textile lining, antique brass-tone hardware", dimensions: "24 × 19 × 11 cm" },
  { slug: "meridian-tote", name: "Meridian Tote", type: "Totes", gender: "women", price: 12490, colours: ["Taupe", "Ink"], images: [tote, women, texture], isNew: true, stock: "in", tagline: "An open, softly structured tote sized for a working day.", material: "Pebbled leather, unlined interior with zip pocket", dimensions: "38 × 30 × 14 cm" },
  { slug: "halden-satchel", name: "Halden Saddle Crossbody", type: "Crossbody", gender: "women", price: 8990, colours: ["Ink", "Cognac"], images: [crossbody, women, texture], bestseller: true, stock: "low", tagline: "A rounded saddle shape with a push-lock and adjustable strap.", material: "Smooth leather, microfibre lining, brass-tone hardware", dimensions: "22 × 16 × 7 cm" },
  { slug: "solenne-mini", name: "Solenne Mini Bag", type: "Handbags", gender: "women", price: 5490, colours: ["Oxblood", "Porcelain"], images: [handbag, texture, hero], isNew: true, gift: true, stock: "in", tagline: "The Aria silhouette, reduced to hold the essentials.", material: "Smooth leather, textile lining", dimensions: "16 × 12 × 7 cm" },
  { slug: "corbel-briefcase", name: "Corbel Slim Briefcase", type: "Laptop & Work", gender: "men", price: 14990, colours: ["Ink", "Espresso"], images: [brief, men, texture], bestseller: true, stock: "in", tagline: "A clean-lined briefcase with a padded sleeve for 14\" laptops.", material: "Grained leather, padded laptop sleeve, gunmetal-tone hardware", dimensions: "39 × 29 × 8 cm" },
  { slug: "atlas-weekender", name: "Atlas Weekender", type: "Travel", gender: "unisex", price: 21990, colours: ["Ink", "Cognac"], images: [travel, texture, brief], isNew: true, stock: "low", tagline: "A generous holdall for two nights away, with a detachable strap.", material: "Grained leather, cotton-blend lining, brass-tone hardware", dimensions: "52 × 30 × 26 cm" },
  { slug: "verso-backpack", name: "Verso Backpack", type: "Backpacks", gender: "unisex", price: 11490, colours: ["Espresso", "Ink"], images: [backpack, men, texture], bestseller: true, stock: "in", tagline: "A rounded city backpack with a front zip pocket and laptop sleeve.", material: "Smooth leather, textile lining", dimensions: "30 × 42 × 14 cm" },
  { slug: "linea-bifold", name: "Linea Bifold Wallet", type: "Wallets", gender: "men", price: 2490, colours: ["Ink", "Espresso", "Cognac"], images: [wallet, slg, texture], bestseller: true, gift: true, stock: "in", tagline: "Six card slots and a full-length note section in a slim fold.", material: "Smooth leather, leather interior", dimensions: "11 × 9.5 × 1.5 cm" },
  { slug: "plinth-card-case", name: "Plinth Card Case", type: "Card Cases", gender: "unisex", price: 1790, colours: ["Oxblood", "Ink", "Taupe"], images: [belt, slg, texture], bestseller: true, gift: true, stock: "in", tagline: "Four slots and a centre pocket, cut close to the cards.", material: "Smooth leather, painted edges", dimensions: "10.5 × 8 × 0.6 cm" },
  { slug: "arc-belt-35", name: "Arc Belt 35mm", type: "Belts", gender: "men", price: 3490, colours: ["Ink", "Cognac"], images: [belt, slg, texture], gift: true, stock: "in", tagline: "A 35mm everyday belt with an antique brass-tone buckle.", material: "Smooth leather, brass-tone buckle", dimensions: "Width 3.5 cm", sizes: ["80", "85", "90", "95", "100", "105"] },
  { slug: "fine-belt-20", name: "Fine Belt 20mm", type: "Belts", gender: "women", price: 2990, colours: ["Ink", "Oxblood", "Taupe"], images: [belt, women, texture], isNew: true, stock: "in", tagline: "A narrow belt for tailoring and knitwear.", material: "Smooth leather, brass-tone buckle", dimensions: "Width 2 cm", sizes: ["70", "75", "80", "85", "90"] },
  { slug: "tessera-key-loop", name: "Tessera Key Loop", type: "Key Accessories", gender: "unisex", price: 590, colours: ["Cognac", "Ink", "Oxblood"], images: [slg, texture, wallet], gift: true, stock: "in", tagline: "A folded leather tab on a solid brass-tone ring.", material: "Smooth leather, brass-tone ring", dimensions: "9 × 3 cm" },
  { slug: "coin-pouch", name: "Ovale Coin Pouch", type: "Pouches", gender: "unisex", price: 990, colours: ["Oxblood", "Ink"], images: [slg, texture, belt], gift: true, stock: "in", tagline: "A small zipped pouch for coins, earphones or keys.", material: "Smooth leather, zip closure", dimensions: "11 × 8 cm" },
  { slug: "folio-pouch", name: "Folio Document Pouch", type: "Pouches", gender: "unisex", price: 4290, colours: ["Ink", "Taupe"], images: [brief, texture, men], stock: "in", tagline: "A flat zipped folio for tablets and papers.", material: "Grained leather, textile lining", dimensions: "34 × 25 cm" },
  { slug: "zip-around-wallet", name: "Linea Zip-Around Wallet", type: "Wallets", gender: "women", price: 3990, colours: ["Oxblood", "Ink", "Porcelain"], images: [wallet, slg, texture], isNew: true, gift: true, stock: "in", tagline: "Twelve card slots, a coin compartment and a smooth zip.", material: "Smooth leather, leather interior", dimensions: "19 × 10 × 2 cm" },
  { slug: "travel-card-holder", name: "Transit Card Holder", type: "Card Cases", gender: "men", price: 1290, colours: ["Ink", "Espresso"], images: [slg, wallet, texture], stock: "out", tagline: "A slim two-slot holder with a thumb cut-out.", material: "Smooth leather", dimensions: "10 × 7 cm" },
  { slug: "rue-shoulder", name: "Rue Shoulder Bag", type: "Handbags", gender: "women", price: 10990, colours: ["Ink", "Oxblood"], images: [women, handbag, texture], bestseller: true, stock: "in", tagline: "A slouched shoulder bag that sits close under the arm.", material: "Soft leather, suede-effect lining", dimensions: "30 × 18 × 9 cm" },
  { slug: "nomad-sling", name: "Nomad Sling", type: "Crossbody", gender: "men", price: 4990, colours: ["Ink", "Espresso"], images: [crossbody, men, texture], isNew: true, stock: "in", tagline: "A compact crossbody for phone, wallet and passport.", material: "Grained leather, textile lining", dimensions: "24 × 15 × 5 cm" },
  { slug: "ledger-laptop-tote", name: "Ledger Work Tote", type: "Laptop & Work", gender: "women", price: 13490, colours: ["Ink", "Taupe"], images: [women, tote, texture], stock: "low", tagline: "A structured tote with a padded laptop sleeve and zip top.", material: "Pebbled leather, padded sleeve, textile lining", dimensions: "40 × 30 × 13 cm" },
  { slug: "dossier-messenger", name: "Dossier Messenger", type: "Laptop & Work", gender: "men", price: 12990, colours: ["Espresso", "Ink"], images: [men, brief, texture], stock: "in", tagline: "A flapped messenger with magnetic closures.", material: "Grained leather, textile lining", dimensions: "38 × 28 × 9 cm" },
  { slug: "cabin-duffle", name: "Cabin Duffle", type: "Travel", gender: "unisex", price: 18490, colours: ["Ink", "Espresso"], images: [travel, brief, texture], stock: "in", tagline: "A cabin-sized duffle with a separate shoe compartment.", material: "Grained leather, textile lining", dimensions: "48 × 27 × 24 cm" },
  { slug: "washbag", name: "Strata Wash Bag", type: "Travel", gender: "unisex", price: 3290, colours: ["Ink", "Cognac"], images: [slg, travel, texture], gift: true, stock: "in", tagline: "A wipe-clean lined wash bag with a wide opening.", material: "Smooth leather, coated lining", dimensions: "25 × 14 × 12 cm" },
];
export const PRODUCTS: Product[] = RAW.map(P);

export type Collection = {
  slug: string;
  title: string;
  eyebrow: string;
  intro: string;
  image: string;
  filter: (p: Product) => boolean;
};

const bagTypes: ProductType[] = ["Handbags", "Totes", "Satchels", "Sling Bags", "Clutches", "Crossbody", "Backpacks", "Laptop & Work", "Travel"];
const slgTypes: ProductType[] = ["Wallets", "Card Cases", "Belts", "Pouches", "Key Accessories", "ID Card Holders", "Passport Holders", "Eyewear Cases", "Mobile Holders", "Desk Accessories"];

export const COLLECTIONS: Collection[] = [
  { slug: "all", title: "The Collection", eyebrow: "Everything", intro: "Every piece in the current house collection, from key loops to weekenders.", image: hero, filter: () => true },
  { slug: "new-in", title: "New In", eyebrow: "Autumn / Winter", intro: "Recent arrivals: sculpted handles, softer totes and a new weekender.", image: hero, filter: (p) => !!p.isNew },
  { slug: "women", title: "Women", eyebrow: "Womenswear", intro: "Top-handles, shoulder bags, totes and small leather goods.", image: women, filter: (p) => p.gender !== "men" },
  { slug: "men", title: "Men", eyebrow: "Menswear", intro: "Briefcases, backpacks, belts and wallets with quiet hardware.", image: men, filter: (p) => p.gender !== "women" },
  { slug: "bags", title: "Bags", eyebrow: "Carry", intro: "From the mini to the weekender — shapes for every distance.", image: women, filter: (p) => bagTypes.includes(p.type) },
  { slug: "small-leather-goods", title: "Small Leather Goods", eyebrow: "Everyday objects", intro: "Wallets, card cases, belts and pouches. Considered gifts start at ₹490.", image: slg, filter: (p) => slgTypes.includes(p.type) },
  { slug: "work-travel", title: "Work & Travel", eyebrow: "In transit", intro: "Laptop bags, backpacks, duffles and wash bags built for movement.", image: travel, filter: (p) => ["Laptop & Work", "Travel", "Backpacks"].includes(p.type) },
  { slug: "gifts", title: "The Gift Edit", eyebrow: "Under ₹6,000", intro: "Small objects, well made. Pieces chosen for giving.", image: slg, filter: (p) => !!p.gift },
];

export const ALL_TYPES: ProductType[] = [...slgTypes, ...bagTypes];
export const PRICE_MIN = 0; // the cheapest pieces (key loops) sit just under ₹500
export const PRICE_MAX = 25000;

export const getProduct = (slug: string) => PRODUCTS.find((p) => p.slug === slug);
export const getCollection = (slug: string) => COLLECTIONS.find((c) => c.slug === slug);

export const formatINR = (n: number) => "₹" + n.toLocaleString("en-IN");

export function searchProducts(q: string, list: Product[] = PRODUCTS) {
  const t = q.trim().toLowerCase();
  if (!t) return list;
  const words = t.split(/\s+/);
  return list.filter((p) => {
    const hay = `${p.name} ${p.type} ${p.gender} ${p.colours.join(" ")} ${p.tagline} ${(p.tags ?? []).join(" ")} ${p.sku ?? ""}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

export type SortKey = "featured" | "new" | "price-asc" | "price-desc";
export type Filters = { types: string[]; colours: string[]; min: number; max: number; inStock: boolean };

export function applyFilters(list: Product[], f: Filters, sort: SortKey) {
  const out = list.filter(
    (p) =>
      (f.types.length === 0 || f.types.includes(p.type)) &&
      (f.colours.length === 0 || p.colours.some((c) => f.colours.includes(c))) &&
      p.price >= f.min &&
      (f.max >= PRICE_MAX || p.price <= f.max) &&
      (!f.inStock || p.stock !== "out"),
  );
  const s = [...out];
  if (sort === "price-asc") s.sort((a, b) => a.price - b.price);
  else if (sort === "price-desc") s.sort((a, b) => b.price - a.price);
  else if (sort === "new") s.sort((a, b) => Number(!!b.isNew) - Number(!!a.isNew) || a.rank - b.rank);
  else s.sort((a, b) => a.rank - b.rank);
  return s;
}
