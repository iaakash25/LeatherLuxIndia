// Shapes returned by the admin inventory API (server/src/routes/admin-inventory.ts).

export type Gender = "women" | "men" | "unisex";
export type StockStatus = "in" | "low" | "out";
export type Availability = "active" | "inactive" | "coming_soon";
export type HoverEffect = "swap" | "slide" | "zoom" | "none";

export type InvProduct = {
  slug: string; sku: string | null; name: string; type: string; gender: Gender;
  priceInr: number; costInr: number | null; marginPct: number | null;
  stockQty: number; reorderLevel: number; stockStatus: StockStatus;
  active: boolean; availability: Availability; hoverEffect: HoverEffect;
  needsReview: boolean; isNew: boolean; bestseller: boolean; gift: boolean;
  colours: string[]; sizes: string[] | null; material: string; tagline: string; dimensions: string; description: string; tags: string[];
  images: string[]; imageLabels: string[]; sourceFolder: string | null; updatedAt: string;
};

export type InvSummary = {
  products: number; active: number; hidden: number; inactive: number; comingSoon: number; needsReview: number; lowStock: number; outOfStock: number;
  missingCost: number; units: number; retailValueInr: number; costValueInr: number;
};

export type InvList = { total: number; products: InvProduct[]; summary: InvSummary; types: { type: string; count: number }[] };

export type Movement = { id: string; delta: number; qtyAfter: number; reason: string; note: string; orderId: string | null; by: string | null; createdAt: string };

export type MediaAsset = {
  id: number; cameraNo: number; sourceFile: string; status: "used" | "spare" | "rejected" | "duplicate"; note: string;
  productSlug: string | null; webPath: string | null; thumbPath: string | null;
};

export const REASON_LABEL: Record<string, string> = {
  opening_stock: "Opening stock", purchase: "Stock received", sale: "Sold", order_cancelled: "Order cancelled",
  return: "Customer return", damage: "Damaged / written off", correction: "Correction", count: "Stock count",
};

export const GENDER_LABEL: Record<Gender, string> = { women: "Women", men: "Men", unisex: "Unisex" };

/**
 * One choice for "what shoppers see", which is two settings on the server: `active` (shown in the shop at all) and `availability`.
 *  - active: for sale, as its stock says
 *  - inactive: still listed, but shows as out of stock and cannot be bought
 *  - coming_soon: still listed with a "Coming soon" label, and cannot be bought yet
 *  - hidden: not shown in the shop
 */
export type ShopStatus = Availability | "hidden";
export const STATUS_OPTIONS: { value: ShopStatus; label: string; hint: string }[] = [
  { value: "active", label: "Active", hint: "For sale, as its stock says." },
  { value: "inactive", label: "Inactive (shows as out of stock)", hint: "Still listed, but shown as out of stock and cannot be bought." },
  { value: "coming_soon", label: "Coming soon", hint: "Listed with a “Coming soon” label and in the Coming Soon category; cannot be bought yet." },
  { value: "hidden", label: "Hidden", hint: "Not shown in the shop at all." },
];
export const statusOf = (p: Pick<InvProduct, "active" | "availability">): ShopStatus => (p.active ? p.availability : "hidden");
/** The fields to send to change a product to `s`. Hidden leaves the availability as it was. */
export const statusPatch = (s: ShopStatus): { active: boolean; availability?: Availability } => (s === "hidden" ? { active: false } : { active: true, availability: s });
export const STATUS_LABEL: Record<ShopStatus, string> = { active: "Active", inactive: "Inactive", coming_soon: "Coming soon", hidden: "Hidden" };
