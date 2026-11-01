import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The photographed catalogue the importer loads (server/data/catalogue). A mistake here would put a broken product on the shop.
const DIR = path.resolve(__dirname, "../data/catalogue");
type Shot = { file: string; n: number; label: string; md5: string; crop?: number[]; erase?: number[][]; clean?: number };
type Item = {
  sku: string; slug: string; name: string; type: string; gender: string; colours: string[]; priceInr: number; material: string; tagline: string; description: string;
  tags: string[]; sizes: string[] | null; stockQty: number; reorderLevel: number; active: boolean; needsReview: boolean; images: Shot[];
};
type Media = { n: number; file: string; md5: string; status: string; note: string; product?: string | null };
const products: Item[] = JSON.parse(fs.readFileSync(path.join(DIR, "products.json"), "utf8"));
const media: Media[] = JSON.parse(fs.readFileSync(path.join(DIR, "media.json"), "utf8"));
const TYPES = ["Belts", "Card Cases", "Clutches", "Desk Accessories", "Eyewear Cases", "Handbags", "ID Card Holders", "Key Accessories", "Laptop & Work", "Mobile Holders", "Passport Holders", "Satchels", "Sling Bags", "Totes", "Wallets"];

describe("catalogue data files", () => {
  it("has unique SKUs and slugs in the expected format", () => {
    expect(new Set(products.map((p) => p.sku)).size).toBe(products.length);
    expect(new Set(products.map((p) => p.slug)).size).toBe(products.length);
    for (const p of products) {
      expect(p.slug, p.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(p.sku, p.slug).toMatch(/^LLI-[A-Z]{3}-\d{3}$/);
    }
  });

  it("gives every product what the storefront and the cart need", () => {
    for (const p of products) {
      expect(TYPES, p.slug).toContain(p.type);
      expect(["women", "men", "unisex"], p.slug).toContain(p.gender);
      expect(p.name.length, p.slug).toBeGreaterThan(2);
      expect(p.description.length, p.slug).toBeGreaterThan(40);
      expect(p.tagline.length, p.slug).toBeGreaterThan(5);
      expect(p.colours.length, p.slug).toBeGreaterThan(0);
      expect(p.tags.length, p.slug).toBeGreaterThan(2);
      expect(Number.isInteger(p.priceInr) && p.priceInr >= 100 && p.priceInr <= 25_000, `${p.slug} price ${p.priceInr}`).toBe(true);
      expect(p.stockQty, p.slug).toBeGreaterThanOrEqual(0);
      expect(p.needsReview, `${p.slug}: imported prices and stock are placeholders until confirmed`).toBe(true);
      if (p.type === "Belts") expect(p.sizes?.length, p.slug).toBeGreaterThan(0); // the cart demands a size for belts
      else expect(p.sizes, p.slug).toBeNull();
    }
  });

  it("puts every live product on at least two photos, with a label for each", () => {
    for (const p of products) {
      expect(p.images.length, p.slug).toBeGreaterThan(0);
      expect(p.images.length, p.slug).toBeLessThanOrEqual(8);
      if (p.active) expect(p.images.length, `${p.slug} is live`).toBeGreaterThanOrEqual(2);
      for (const i of p.images) {
        expect(i.label.length, `${p.slug} photo ${i.n}`).toBeGreaterThan(0);
        expect(i.md5, p.slug).toMatch(/^[0-9a-f]{10}$/);
        // A reviewed photo whose cut-out haze is whitened; the number is its brightness limit. Never on wallets, whose white card inserts are real.
        if (i.clean !== undefined) {
          expect(Number.isInteger(i.clean) && i.clean >= 100 && i.clean <= 230, `${p.slug} photo ${i.n} clean limit`).toBe(true);
          expect(["Wallets", "Card Cases", "Passport Holders", "Clutches", "Eyewear Cases"], `${p.slug}: cleaning would erase real product parts`).not.toContain(p.type);
        }
        for (const r of [...(i.crop ? [i.crop] : []), ...(i.erase ?? [])]) {
          expect(r.length).toBe(4);
          expect(r[0]! < r[2]! && r[1]! < r[3]! && r.every((v) => v >= 0 && v <= 1), `${p.slug} ${i.n} rectangle`).toBe(true);
        }
      }
    }
  });

  it("uses each photo once, and every photo has a recorded fate", () => {
    const used = products.flatMap((p) => p.images.map((i) => i.file));
    expect(new Set(used).size, "a photo is on two products").toBe(used.length);
    expect(new Set(media.map((m) => m.file)).size, "duplicate source_file").toBe(media.length);
    for (const m of media) {
      expect(["used", "spare", "rejected", "duplicate"], `photo ${m.n}`).toContain(m.status);
      if (m.status !== "used") expect(m.note.length, `photo ${m.n} needs a reason`).toBeGreaterThan(0);
    }
    expect(new Set(media.filter((m) => m.status === "used").map((m) => m.file))).toEqual(new Set(used));
  });
});
