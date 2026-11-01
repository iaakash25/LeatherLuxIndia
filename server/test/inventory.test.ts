import fs from "node:fs";
import path from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { env } from "../src/config/env.js";
import { closePool, query } from "../src/db/pool.js";
import { migrate } from "../src/db/migrate.js";
import { seed } from "../src/db/seed.js";
import { purgeAll } from "../src/lib/caches.js";

const ORIGIN = "https://shop.example.com";
const PASSWORD = "a-long-test-passphrase";
const app = createApp();
const address = { name: "Asha Rao", phone: "9876543210", line1: "12 MG Road", city: "Bengaluru", state: "Karnataka", pincode: "560001" };

function client() {
  const agent = request.agent(app);
  const wrap = (m: "get" | "post" | "put" | "patch" | "delete") => (url: string) => agent[m](url).set("Origin", ORIGIN);
  return { agent, get: wrap("get"), post: wrap("post"), put: wrap("put"), patch: wrap("patch"), del: wrap("delete") };
}
async function signUp(email: string, name: string) {
  const c = client();
  expect((await c.post("/api/auth/register").send({ name, email, password: PASSWORD })).status).toBe(201);
  return c;
}
async function adminClient(email: string, name: string) {
  await signUp(email, name);
  await query("UPDATE users SET role = 'admin' WHERE email = $1", [email]);
  const c = client();
  expect((await c.post("/api/auth/login").send({ identifier: email, password: PASSWORD })).status).toBe(200);
  return c;
}

const SLUG = "zz-test-satchel";
const mediaDir = () => env().mediaDir;
let admin: ReturnType<typeof client>;
let customer: ReturnType<typeof client>;
const assets: Record<string, number> = {};

beforeAll(async () => {
  await migrate();
  await seed();
  await query(
    `INSERT INTO products (slug, name, type, gender, price_inr, colours, images, image_labels, stock_qty, tagline, material, dimensions, rank, sku, description, tags, reorder_level, needs_review, active)
     VALUES ($1,'ZZ Test Satchel','Satchels','women',7990,'{Tan,Navy}',$2,'{Front,Back}',4,'A structured test satchel','Full-grain leather','',900,'LLI-TST-001','Roomy satchel, made for tests.','{zebra,structured}',5,true,true),
            ('zz-test-keyloop','ZZ Test Key Loop','Key Accessories','unisex',490,'{Ink}',$3,'{Front}',20,'A cheap key loop','Leather','',901,'LLI-TST-002','','{}',3,false,true)`,
    [SLUG, [`/media/products/${SLUG}/1-aaaa.webp`, `/media/products/${SLUG}/2-bbbb.webp`], ["zz-test-keyloop-image"]],
  );
  for (const [key, status, web] of [["spare1", "spare", "/media/library/zz-1-cccc.webp"], ["spare2", "spare", "/media/library/zz-2-dddd.webp"], ["rejected", "rejected", null]] as const) {
    const { rows } = await query<{ id: string }>(
      "INSERT INTO media_assets (camera_no, source_file, content_hash, status, note, web_path, thumb_path) VALUES (9000, $1, $2, $3, 'test', $4, $5) RETURNING id",
      [`zz-test/${key}.JPG`, key, status, web, web ? web.replace(".webp", "-sm.webp") : null],
    );
    assets[key] = Number(rows[0]!.id);
  }
  purgeAll();
  admin = await adminClient("inv-admin@example.com", "Ines Admin");
  customer = await signUp("inv-customer@example.com", "Cara Customer");
  fs.mkdirSync(path.join(mediaDir(), "products", SLUG), { recursive: true });
  fs.writeFileSync(path.join(mediaDir(), "products", SLUG, "1-aaaa-sm.webp"), Buffer.from("RIFF....WEBPVP8 test"));
  fs.writeFileSync(path.join(mediaDir(), "secret.txt"), "not a photo");
});

afterAll(async () => {
  // The database is shared with the other test files: leave nothing of ours behind.
  await query("DELETE FROM orders WHERE user_id IN (SELECT id FROM users WHERE email = 'inv-customer@example.com')");
  await query("DELETE FROM products WHERE slug LIKE 'zz-test-%'");
  await query("DELETE FROM media_assets WHERE source_file LIKE 'zz-test/%'");
  fs.rmSync(mediaDir(), { recursive: true, force: true });
  purgeAll();
  await closePool();
});

describe("storefront shape for photographed products", () => {
  it("returns sku, description, tags, labels and a small version of every photo", async () => {
    const r = await request(app).get(`/api/products/${SLUG}`);
    expect(r.status).toBe(200);
    expect(r.body.product).toMatchObject({
      sku: "LLI-TST-001", description: "Roomy satchel, made for tests.", tags: ["zebra", "structured"], imageLabels: ["Front", "Back"],
      images: [`/media/products/${SLUG}/1-aaaa.webp`, `/media/products/${SLUG}/2-bbbb.webp`],
      thumbs: [`/media/products/${SLUG}/1-aaaa-sm.webp`, `/media/products/${SLUG}/2-bbbb-sm.webp`],
    });
    // The original sample products still point at bundled asset keys, which have no separate small version.
    const sample = await request(app).get("/api/products/aria-top-handle");
    expect(sample.body.product.thumbs).toEqual(sample.body.product.images);
  });

  it("searches tags and SKUs, and files the new types under the right collections", async () => {
    expect((await request(app).get("/api/products?q=zebra")).body.products.map((p: { slug: string }) => p.slug)).toEqual([SLUG]);
    expect((await request(app).get("/api/products?q=lli-tst-001")).body.products.map((p: { slug: string }) => p.slug)).toEqual([SLUG]);
    const bags = (await request(app).get("/api/collections/bags?limit=100")).body.products.map((p: { slug: string }) => p.slug);
    expect(bags).toContain(SLUG);
    expect(bags).not.toContain("zz-test-keyloop");
    const slg = (await request(app).get("/api/collections/small-leather-goods?limit=100")).body.products.map((p: { slug: string }) => p.slug);
    expect(slg).toContain("zz-test-keyloop");
    expect((await request(app).get("/api/collections/women?limit=100")).body.products.map((p: { slug: string }) => p.slug)).toContain("zz-test-keyloop"); // unisex
  });

  it("shows pieces under 500 rupees with the default price filter", async () => {
    expect((await request(app).get("/api/products?limit=100")).body.products.map((p: { slug: string }) => p.slug)).toContain("zz-test-keyloop");
  });

  it("says 'low' at or below the product's own reorder level", async () => {
    expect((await request(app).get(`/api/products/${SLUG}`)).body.product.stock).toBe("low"); // 4 in stock, reorder level 5
    expect((await request(app).get("/api/products/zz-test-keyloop")).body.product.stock).toBe("in");
  });
});

describe("product photos are served from /media", () => {
  it("serves a file with long-lived caching and cross-origin access", async () => {
    const r = await request(app).get(`/media/products/${SLUG}/1-aaaa-sm.webp`);
    expect(r.status).toBe(200);
    expect(r.headers["cache-control"]).toMatch(/max-age=31536000/);
    expect(r.headers["cache-control"]).toMatch(/immutable/);
    expect(r.headers["cache-control"]).not.toMatch(/no-store/);
    expect(r.headers["cross-origin-resource-policy"]).toBe("cross-origin");
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("is read-only and stays inside the media folder", async () => {
    expect((await request(app).get("/media/products/zz-test-satchel/missing.webp")).status).toBe(404);
    expect((await request(app).get("/media/products/")).status).toBe(404); // no directory listing
    expect((await request(app).get("/media/%2e%2e/package.json")).status).toBe(404);
    expect((await request(app).get("/media/..%2f..%2fpackage.json")).status).toBe(404);
    expect((await request(app).post(`/media/products/${SLUG}/1-aaaa-sm.webp`).set("Origin", ORIGIN)).status).toBe(404);
  });
});

describe("inventory API access", () => {
  it("is for admins only", async () => {
    expect((await request(app).get("/api/admin/inventory")).status).toBe(401);
    expect((await customer.get("/api/admin/inventory")).status).toBe(403);
    expect((await customer.patch(`/api/admin/inventory/${SLUG}`).send({ priceInr: 1 })).status).toBe(403);
    expect((await customer.post(`/api/admin/inventory/${SLUG}/stock`).send({ mode: "add", qty: 5, reason: "purchase" })).status).toBe(403);
    expect((await customer.get("/api/admin/media-library")).status).toBe(403);
  });
});

describe("inventory list", () => {
  it("lists every product with cost, stock and review state, plus totals", async () => {
    const r = await admin.get("/api/admin/inventory?limit=500");
    expect(r.status).toBe(200);
    const p = r.body.products.find((x: { slug: string }) => x.slug === SLUG);
    expect(p).toMatchObject({ sku: "LLI-TST-001", priceInr: 7990, costInr: null, marginPct: null, stockQty: 4, reorderLevel: 5, stockStatus: "low", needsReview: true, active: true });
    expect(p.imageLabels).toEqual(["Front", "Back"]);
    expect(r.body.summary.products).toBe(r.body.total);
    expect(r.body.summary.needsReview).toBeGreaterThanOrEqual(1);
    expect(r.body.summary.missingCost).toBe(r.body.total);
    expect(r.body.types.find((t: { type: string }) => t.type === "Satchels").count).toBe(1);
  });

  it("filters by status, type, gender and search", async () => {
    const slugs = async (qs: string) => (await admin.get(`/api/admin/inventory?${qs}`)).body.products.map((x: { slug: string }) => x.slug);
    expect(await slugs("status=review")).toContain(SLUG);
    expect(await slugs("status=review")).not.toContain("zz-test-keyloop");
    expect(await slugs("status=low")).toContain(SLUG);
    expect(await slugs("status=hidden")).not.toContain(SLUG);
    expect(await slugs("type=Satchels")).toEqual([SLUG]);
    expect(await slugs("gender=unisex&type=Key%20Accessories")).toContain("zz-test-keyloop");
    expect(await slugs("gender=men&type=Key%20Accessories")).not.toContain("zz-test-keyloop");
    expect(await slugs("q=zebra")).toEqual([SLUG]);
    expect(await slugs("q=lli-tst-002")).toEqual(["zz-test-keyloop"]);
    expect((await admin.get("/api/admin/inventory?status=bogus")).status).toBe(400);
  });
});

describe("editing prices and details", () => {
  it("changes price, cost and details, shows the new price on the storefront at once, and works out the margin", async () => {
    await request(app).get(`/api/products/${SLUG}`); // warm the cache
    const r = await admin.patch(`/api/admin/inventory/${SLUG}`).send({
      priceInr: 8490, costInr: 3400, tags: ["Zebra", "zebra", "Everyday"], colours: ["Tan", "Navy", "Tan"], description: "Now with a longer description.", needsReview: false, reorderLevel: 2,
    });
    expect(r.status).toBe(200);
    expect(r.body.product).toMatchObject({ priceInr: 8490, costInr: 3400, marginPct: 60, tags: ["zebra", "everyday"], colours: ["Tan", "Navy"], needsReview: false, reorderLevel: 2, stockStatus: "in" });
    const pub = await request(app).get(`/api/products/${SLUG}`);
    expect(pub.body.product).toMatchObject({ price: 8490, description: "Now with a longer description.", stock: "in" });
  });

  it("can hide a product from the storefront and bring it back", async () => {
    expect((await admin.patch(`/api/admin/inventory/${SLUG}`).send({ active: false })).status).toBe(200);
    expect((await request(app).get(`/api/products/${SLUG}`)).status).toBe(404);
    expect((await admin.get("/api/admin/inventory?status=hidden")).body.products.map((x: { slug: string }) => x.slug)).toContain(SLUG);
    expect((await admin.patch(`/api/admin/inventory/${SLUG}`).send({ active: true })).status).toBe(200);
    expect((await request(app).get(`/api/products/${SLUG}`)).status).toBe(200);
  });

  it("rejects bad input and unknown fields", async () => {
    const bad = (body: unknown) => admin.patch(`/api/admin/inventory/${SLUG}`).send(body as object);
    expect((await bad({})).status).toBe(400);
    expect((await bad({ priceInr: 0 })).status).toBe(400);
    expect((await bad({ priceInr: 12.5 })).status).toBe(400);
    expect((await bad({ costInr: -1 })).status).toBe(400);
    expect((await bad({ colours: [] })).status).toBe(400);
    expect((await bad({ gender: "kids" })).status).toBe(400);
    expect((await bad({ name: "<script>" })).status).toBe(400);
    expect((await bad({ stockQty: 99 })).status).toBe(400); // stock changes go through /stock so they reach the ledger
    expect((await bad({ slug: "renamed" })).status).toBe(400);
    expect((await admin.patch("/api/admin/inventory/no-such-piece").send({ priceInr: 100 })).status).toBe(404);
    expect((await admin.patch(`/api/admin/inventory/${SLUG}`).send({ costInr: null })).status).toBe(200); // cost can be cleared
  });
});

describe("stock ledger", () => {
  const stock = (body: object) => admin.post(`/api/admin/inventory/${SLUG}/stock`).send(body);
  const movements = async () => (await admin.get(`/api/admin/inventory/${SLUG}`)).body.movements as { delta: number; qtyAfter: number; reason: string; note: string; by: string | null }[];

  it("records purchases, damage and counts, each with who and why", async () => {
    const before = (await movements()).length;
    const r1 = await stock({ mode: "add", qty: 10, reason: "purchase", note: "PO-1001" });
    expect(r1.status).toBe(200);
    expect(r1.body.change).toEqual({ changed: true, before: 4, after: 14 });
    expect((await stock({ mode: "add", qty: -3, reason: "damage", note: "scuffed in the warehouse" })).body.product.stockQty).toBe(11);
    expect((await stock({ mode: "set", qty: 12, reason: "count" })).body.product.stockQty).toBe(12);
    const m = await movements();
    expect(m).toHaveLength(before + 3);
    expect(m.slice(0, 3)).toMatchObject([
      { delta: 1, qtyAfter: 12, reason: "count", by: "Ines Admin" },
      { delta: -3, qtyAfter: 11, reason: "damage", note: "scuffed in the warehouse" },
      { delta: 10, qtyAfter: 14, reason: "purchase", note: "PO-1001" },
    ]);
    expect((await request(app).get(`/api/products/${SLUG}`)).body.product.stock).toBe("in");
  });

  it("logs nothing when the count is already right", async () => {
    const before = (await movements()).length;
    const r = await stock({ mode: "set", qty: 12, reason: "count" });
    expect(r.body.change.changed).toBe(false);
    expect(await movements()).toHaveLength(before);
  });

  it("never goes below zero and rejects a reason that contradicts the direction", async () => {
    const before = (await movements()).length;
    const r = await stock({ mode: "add", qty: -500, reason: "correction" });
    expect(r.status).toBe(409);
    expect((await stock({ mode: "add", qty: -1, reason: "purchase" })).status).toBe(400);
    expect((await stock({ mode: "add", qty: 1, reason: "damage" })).status).toBe(400);
    expect((await stock({ mode: "add", qty: 0, reason: "correction" })).status).toBe(400);
    expect((await stock({ mode: "set", qty: -1, reason: "count" })).status).toBe(400);
    expect((await stock({ mode: "set", qty: 5, reason: "purchase" })).status).toBe(400);
    expect((await stock({ mode: "add", qty: 1, reason: "sale" })).status).toBe(400); // sales are written by orders only
    expect((await stock({ mode: "add", qty: 1_000_000, reason: "purchase" })).status).toBe(400);
    expect(await movements()).toHaveLength(before);
    expect((await admin.post("/api/admin/inventory/no-such-piece/stock").send({ mode: "add", qty: 1, reason: "purchase" })).status).toBe(404);
  });

  it("the older product editor routes a new stock number through the ledger as well", async () => {
    const r = await admin.patch(`/api/admin/products/${SLUG}`).send({ stockQty: 9 });
    expect(r.status).toBe(200);
    expect((await movements())[0]).toMatchObject({ delta: -3, qtyAfter: 9, reason: "correction" });
  });

  it("writes a sale for an order and gives the stock back, on the ledger, when it is cancelled", async () => {
    await customer.post("/api/cart/items").send({ slug: SLUG, colour: "Tan", qty: 2 });
    const order = await customer.post("/api/orders").send({ shippingAddress: address });
    expect(order.status).toBe(201);
    expect((await movements())[0]).toMatchObject({ delta: -2, qtyAfter: 7, reason: "sale" });
    const row = (await query<{ order_id: string }>("SELECT order_id FROM inventory_movements WHERE product_slug = $1 AND reason = 'sale'", [SLUG])).rows[0]!;
    expect(row.order_id).toBe(order.body.order.id);

    expect((await admin.patch(`/api/admin/orders/${order.body.order.id}`).send({ status: "cancelled" })).status).toBe(200);
    expect((await movements())[0]).toMatchObject({ delta: 2, qtyAfter: 9, reason: "order_cancelled" });
    const total = (await query<{ n: string }>("SELECT sum(delta)::text AS n FROM inventory_movements WHERE product_slug = $1", [SLUG])).rows[0]!.n;
    expect((await admin.get(`/api/admin/inventory/${SLUG}`)).body.product.stockQty).toBe(9);
    expect(Number(total)).toBe(9 - 4); // every unit that moved is on the ledger (the seeded 4 predates it)
  });
});

describe("photo gallery", () => {
  const detail = async () => (await admin.get(`/api/admin/inventory/${SLUG}`)).body.product as { images: string[]; imageLabels: string[] };

  it("lists the photo library with a count per status", async () => {
    const r = await admin.get("/api/admin/media-library?status=spare");
    expect(r.status).toBe(200);
    expect(r.body.assets.map((a: { sourceFile: string }) => a.sourceFile)).toEqual(expect.arrayContaining(["zz-test/spare1.JPG", "zz-test/spare2.JPG"]));
    expect(r.body.counts.spare).toBeGreaterThanOrEqual(2);
    expect((await admin.get("/api/admin/media-library?status=nonsense")).status).toBe(400);
  });

  it("adds a spare photo to a product and takes it off the shelf", async () => {
    const r = await admin.post(`/api/admin/inventory/${SLUG}/images`).send({ assetId: assets["spare1"], label: "Inside" });
    expect(r.status).toBe(200);
    expect(r.body.product.images).toEqual([`/media/products/${SLUG}/1-aaaa.webp`, `/media/products/${SLUG}/2-bbbb.webp`, "/media/library/zz-1-cccc.webp"]);
    expect(r.body.product.imageLabels).toEqual(["Front", "Back", "Inside"]);
    expect((await request(app).get(`/api/products/${SLUG}`)).body.product.thumbs[2]).toBe("/media/library/zz-1-cccc-sm.webp");
    const row = (await query<{ status: string; product_slug: string }>("SELECT status, product_slug FROM media_assets WHERE id = $1", [assets["spare1"]])).rows[0]!;
    expect(row).toEqual({ status: "used", product_slug: SLUG });
  });

  it("only accepts a spare, processed photo", async () => {
    const again = await admin.post(`/api/admin/inventory/${SLUG}/images`).send({ assetId: assets["spare1"] });
    expect(again.status).toBe(409); // already on a product
    expect((await admin.post(`/api/admin/inventory/${SLUG}/images`).send({ assetId: assets["rejected"] })).status).toBe(409);
    expect((await admin.post(`/api/admin/inventory/${SLUG}/images`).send({ assetId: 987654321 })).status).toBe(404);
    expect((await admin.post(`/api/admin/inventory/${SLUG}/images`).send({})).status).toBe(400);
  });

  it("makes a photo the cover, keeping its label with it", async () => {
    const r = await admin.post(`/api/admin/inventory/${SLUG}/images/2/cover`).send({});
    expect(r.status).toBe(200);
    expect(r.body.product.images[0]).toBe("/media/library/zz-1-cccc.webp");
    expect(r.body.product.imageLabels).toEqual(["Inside", "Front", "Back"]);
    expect((await admin.post(`/api/admin/inventory/${SLUG}/images/9/cover`).send({})).status).toBe(404);
  });

  it("removes a photo, returns a library photo to the shelf, and keeps at least one", async () => {
    const r = await admin.del(`/api/admin/inventory/${SLUG}/images/0`);
    expect(r.status).toBe(200);
    expect(r.body.product.images).toEqual([`/media/products/${SLUG}/1-aaaa.webp`, `/media/products/${SLUG}/2-bbbb.webp`]);
    expect((await query<{ status: string }>("SELECT status FROM media_assets WHERE id = $1", [assets["spare1"]])).rows[0]!.status).toBe("spare");
    expect((await admin.del(`/api/admin/inventory/${SLUG}/images/0`)).status).toBe(200);
    expect((await admin.del(`/api/admin/inventory/${SLUG}/images/0`)).status).toBe(409); // the last one stays
    expect((await detail()).images).toHaveLength(1);
    expect((await admin.del(`/api/admin/inventory/${SLUG}/images/5`)).status).toBe(404);
  });
});
