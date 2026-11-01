// Shapes returned by the admin inventory API (server/src/routes/admin-inventory.ts).

export type Gender = "women" | "men" | "unisex";
export type StockStatus = "in" | "low" | "out";

export type InvProduct = {
  slug: string; sku: string | null; name: string; type: string; gender: Gender;
  priceInr: number; costInr: number | null; marginPct: number | null;
  stockQty: number; reorderLevel: number; stockStatus: StockStatus;
  active: boolean; needsReview: boolean; isNew: boolean; bestseller: boolean; gift: boolean;
  colours: string[]; sizes: string[] | null; material: string; tagline: string; dimensions: string; description: string; tags: string[];
  images: string[]; imageLabels: string[]; sourceFolder: string | null; updatedAt: string;
};

export type InvSummary = {
  products: number; active: number; hidden: number; needsReview: number; lowStock: number; outOfStock: number;
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
