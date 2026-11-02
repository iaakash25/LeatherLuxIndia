import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { query } from "../src/db/pool.js";
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
  return { agent, get: wrap("get"), post: wrap("post"), patch: wrap("patch"), del: wrap("delete") };
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

/** The smallest thing the server accepts as a WebP: the RIFF/WEBP signature followed by some bytes. */
const webp = (fill: number, size = 40) => Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP"), Buffer.from("VP8 "), Buffer.alloc(size, fill)]);
/** The upload body the browser sends: [4 bytes: size of the full-size file][full-size file][small file]. */
const framed = (full: Buffer, thumb: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(full.length); return Buffer.concat([len, full, thumb]); };

let admin: ReturnType<typeof client>;
let customer: ReturnType<typeof client>;

async function upload(c = admin, full = webp(1), thumb = webp(2, 20)) {
  const r = await c.post("/api/admin/photos").set("Content-Type", "application/octet-stream").send(framed(full, thumb));
  return r;
}
const goodProduct = (photos: { id: string; label?: string }[], extra: Record<string, unknown> = {}) => ({
  name: "Zz Added Satchel", type: "Zz Added Type", gender: "women", priceInr: 6990, costInr: 2800, stockQty: 6, colours: ["Tan", "Ink"],
  tagline: "Added from the console", description: "A test piece.", tags: ["Test", "added"], photos, ...extra,
});

beforeAll(async () => {
  await migrate();
  await seed();
  admin = await adminClient("inv-add-admin@example.com", "Admin");
  customer = await signUp("inv-add-customer@example.com", "Shopper");
});

// The test database is shared with the other test files, so everything this file adds is removed again.
afterAll(async () => {
  await query("DELETE FROM products WHERE slug LIKE 'zz-added-%'");
  await query("DELETE FROM product_photos");
  purgeAll();
});

describe("uploading a photo", () => {
  it("stores it and serves it back, with a year-long cache and no sniffing", async () => {
    const full = webp(7, 60), thumb = webp(8, 25);
    const r = await upload(admin, full, thumb);
    expect(r.status).toBe(201);
    expect(r.body.photo.url).toBe(`/api/photos/${r.body.photo.id}`);

    const big = await request(app).get(r.body.photo.url);
    expect(big.status).toBe(200);
    expect(big.headers["content-type"]).toMatch(/image\/webp/);
    expect(big.headers["cache-control"]).toContain("immutable");
    expect(big.headers["cache-control"]).toContain("max-age=31536000");
    expect(big.headers["x-content-type-options"]).toBe("nosniff");
    expect(big.headers["cross-origin-resource-policy"]).toBe("cross-origin");
    expect(Buffer.compare(big.body, full)).toBe(0);

    const small = await request(app).get(`${r.body.photo.url}/thumb`);
    expect(small.status).toBe(200);
    expect(Buffer.compare(small.body, thumb)).toBe(0);

    const again = await request(app).get(r.body.photo.url).set("If-None-Match", big.headers["etag"]!);
    expect(again.status).toBe(304);
  });

  it("answers 404 for an unknown or malformed id, and needs an admin to upload", async () => {
    expect((await request(app).get("/api/photos/00000000-0000-4000-8000-000000000000")).status).toBe(404);
    expect((await request(app).get("/api/photos/not-an-id")).status).toBe(404);
    expect((await upload(customer)).status).toBe(403);
    const anon = request(app).post("/api/admin/photos").set("Origin", ORIGIN).set("Content-Type", "application/octet-stream").send(framed(webp(1), webp(2)));
    expect((await anon).status).toBe(401);
  });

  it("refuses anything that is not really an image, and a small version of another kind", async () => {
    const notImage = Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>".padEnd(60, " "));
    expect((await upload(admin, notImage, webp(2))).status).toBe(400);
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)]);
    expect((await upload(admin, webp(1), png)).status).toBe(400); // kinds differ
    const tooShort = await admin.post("/api/admin/photos").set("Content-Type", "application/octet-stream").send(Buffer.from([0, 0, 0, 1]));
    expect(tooShort.status).toBe(400);
    const lying = Buffer.alloc(24); lying.writeUInt32BE(5000);
    expect((await admin.post("/api/admin/photos").set("Content-Type", "application/octet-stream").send(lying)).status).toBe(400);
  });

  it("refuses a full-size photo over 1 MB", async () => {
    const huge = webp(3, 1024 * 1024 + 10);
    expect((await upload(admin, huge, webp(2))).status).toBe(400);
  });
});

describe("adding a product", () => {
  it("creates it with 1 to 4 uploaded photos, an automatic style number, opening stock and the chosen hover effect", async () => {
    const ids = [] as string[];
    for (let i = 0; i < 4; i++) ids.push((await upload(admin, webp(10 + i), webp(20 + i))).body.photo.id);

    const r = await admin.post("/api/admin/inventory").send(goodProduct(ids.map((id, i) => ({ id, label: i === 1 ? "Side" : "" })), { hoverEffect: "slide", isNew: true }));
    expect(r.status).toBe(201);
    const p = r.body.product;
    expect(p.slug).toBe("zz-added-satchel");
    expect(p.sku).toMatch(/^LLI-NEW-\d{3}$/);
    expect(p.images).toEqual(ids.map((id) => `/api/photos/${id}`));
    expect(p.imageLabels).toEqual(["Front", "Side", "View 3", "View 4"]);
    expect(p).toMatchObject({ availability: "active", hoverEffect: "slide", active: true, needsReview: false, stockQty: 6, isNew: true, tags: ["test", "added"] });

    const moves = (await query<{ delta: number; reason: string }>("SELECT delta, reason FROM inventory_movements WHERE product_slug = $1", [p.slug])).rows;
    expect(moves).toEqual([{ delta: 6, reason: "opening_stock" }]);

    // the shop sees it, with small versions for the cards
    purgeAll();
    const shop = await request(app).get(`/api/products/${p.slug}`);
    expect(shop.status).toBe(200);
    expect(shop.body.product).toMatchObject({ hoverEffect: "slide", availability: "active", stock: "in" });
    expect(shop.body.product.thumbs[0]).toBe(`${p.images[0]}/thumb`);
  });

  it("gives the same name a different address, and numbers style numbers one after another", async () => {
    const id = (await upload()).body.photo.id;
    const r = await admin.post("/api/admin/inventory").send(goodProduct([{ id }]));
    expect(r.status).toBe(201);
    expect(r.body.product.slug).toBe("zz-added-satchel-2");
    const first = Number((await query<{ sku: string }>("SELECT sku FROM products WHERE slug = 'zz-added-satchel'")).rows[0]!.sku.slice(-3));
    expect(Number(r.body.product.sku.slice(-3))).toBe(first + 1);
  });

  it("needs at least 1 and at most 4 photos, and real uploaded ones", async () => {
    expect((await admin.post("/api/admin/inventory").send(goodProduct([]))).status).toBe(400);
    const five = [] as { id: string }[];
    for (let i = 0; i < 5; i++) five.push({ id: (await upload()).body.photo.id });
    const tooMany = await admin.post("/api/admin/inventory").send(goodProduct(five));
    expect(tooMany.status).toBe(400);
    expect(JSON.stringify(tooMany.body)).toMatch(/up to 4/);
    expect((await admin.post("/api/admin/inventory").send(goodProduct([{ id: "00000000-0000-4000-8000-000000000000" }]))).status).toBe(400);
    const id = (await upload()).body.photo.id;
    expect((await admin.post("/api/admin/inventory").send(goodProduct([{ id }, { id }]))).status).toBe(400);
  });

  it("checks the details: a style number already used, a missing price or colour, and who is asking", async () => {
    const id = (await upload()).body.photo.id;
    const used = await query<{ sku: string }>("SELECT sku FROM products WHERE sku IS NOT NULL LIMIT 1");
    const clash = await admin.post("/api/admin/inventory").send(goodProduct([{ id }], { name: "Zz Clash", sku: used.rows[0]!.sku.toLowerCase() }));
    expect(clash.status).toBe(409);
    expect((await admin.post("/api/admin/inventory").send(goodProduct([{ id }], { priceInr: 0, name: "Zz No Price" }))).status).toBe(400);
    expect((await admin.post("/api/admin/inventory").send(goodProduct([{ id }], { colours: [], name: "Zz No Colour" }))).status).toBe(400);
    expect((await admin.post("/api/admin/inventory").send(goodProduct([{ id }], { hoverEffect: "spin", name: "Zz Spin" }))).status).toBe(400);
    expect((await customer.post("/api/admin/inventory").send(goodProduct([{ id }], { name: "Zz Customer" }))).status).toBe(403);
    expect((await query("SELECT 1 FROM products WHERE name LIKE 'Zz %' AND name <> 'Zz Added Satchel'")).rowCount).toBe(0);
  });

  it("keeps an uploaded photo that is on a product, and can add another to an existing product", async () => {
    const photo = (await upload()).body.photo.id;
    const added = await admin.post("/api/admin/inventory/zz-added-satchel/images").send({ photoId: photo, label: "Inside" });
    expect(added.status).toBe(200);
    expect(added.body.product.images.at(-1)).toBe(`/api/photos/${photo}`);
    expect(added.body.product.imageLabels.at(-1)).toBe("Inside");
    expect((await admin.post("/api/admin/inventory/zz-added-satchel/images").send({ photoId: photo })).status).toBe(409);
    expect((await admin.post("/api/admin/inventory/zz-added-satchel/images").send({ photoId: photo, assetId: 1 })).status).toBe(400);
  });
});

describe("availability: active, inactive, coming soon", () => {
  const slug = "zz-added-satchel";
  const shopProduct = async () => { purgeAll(); return (await request(app).get(`/api/products/${slug}`)).body.product; };

  it("an inactive product stays visible but shows as out of stock and cannot be bought, whatever its count", async () => {
    const r = await admin.patch(`/api/admin/inventory/${slug}`).send({ availability: "inactive" });
    expect(r.status).toBe(200);
    expect(r.body.product).toMatchObject({ availability: "inactive", active: true, stockQty: 6 });

    expect(await shopProduct()).toMatchObject({ availability: "inactive", stock: "out" });
    purgeAll();
    const list = await request(app).get("/api/products?limit=100");
    expect(list.body.products.some((p: { slug: string }) => p.slug === slug)).toBe(true); // still listed
    const inStock = await request(app).get("/api/products?limit=100&inStock=true");
    expect(inStock.body.products.some((p: { slug: string }) => p.slug === slug)).toBe(false);

    const add = await customer.post("/api/cart/items").send({ slug, colour: "Tan", qty: 1 });
    expect(add.status).toBe(400);
    expect(JSON.stringify(add.body)).toMatch(/unavailable/i);
  });

  it("a coming-soon product is listed in the Coming Soon collection, labelled, and cannot be ordered", async () => {
    expect((await admin.patch(`/api/admin/inventory/${slug}`).send({ availability: "coming_soon" })).status).toBe(200);
    expect(await shopProduct()).toMatchObject({ availability: "coming_soon", stock: "out" });

    purgeAll();
    const coming = await request(app).get("/api/collections/coming-soon");
    expect(coming.status).toBe(200);
    expect(coming.body.collection.slug).toBe("coming-soon");
    expect(coming.body.products.map((p: { slug: string }) => p.slug)).toEqual([slug]);
    const all = await request(app).get("/api/collections/all?limit=100");
    expect(all.body.products.some((p: { slug: string }) => p.slug === slug)).toBe(true);

    const add = await customer.post("/api/cart/items").send({ slug, colour: "Tan", qty: 1 });
    expect(add.status).toBe(400);
    expect(JSON.stringify(add.body)).toMatch(/coming soon/i);
  });

  it("a piece that was already in a bag is shown as unavailable and blocks the order until it is removed", async () => {
    const me = (await query<{ id: string }>("SELECT id FROM users WHERE email = 'inv-add-customer@example.com'")).rows[0]!.id;
    await query("INSERT INTO cart_items (user_id, product_slug, colour, size, qty) VALUES ($1,$2,'Tan','',1)", [me, slug]);
    const bag = await customer.get("/api/cart");
    expect(bag.body.items.find((i: { slug: string }) => i.slug === slug)).toMatchObject({ available: false, stock: "out" });
    const order = await customer.post("/api/orders").set("Idempotency-Key", "zz-key-0001").send({ shippingAddress: address });
    expect(order.status).toBe(409);
    expect(order.body.error.code).toBe("unavailable");
    await query("DELETE FROM cart_items WHERE user_id = $1", [me]);
  });

  it("active again means for sale again; hidden still hides it altogether", async () => {
    expect((await admin.patch(`/api/admin/inventory/${slug}`).send({ availability: "active" })).status).toBe(200);
    expect(await shopProduct()).toMatchObject({ availability: "active", stock: "in" });
    expect((await customer.post("/api/cart/items").send({ slug, colour: "Tan", qty: 1 })).status).toBeLessThan(300);

    expect((await admin.patch(`/api/admin/inventory/${slug}`).send({ active: false })).status).toBe(200);
    purgeAll();
    expect((await request(app).get(`/api/products/${slug}`)).status).toBe(404);
    expect((await admin.patch(`/api/admin/inventory/${slug}`).send({ active: true })).status).toBe(200);
  });

  it("the admin list can filter by status and counts them", async () => {
    await admin.patch(`/api/admin/inventory/${slug}`).send({ availability: "coming_soon" });
    const soon = await admin.get("/api/admin/inventory?status=coming_soon");
    expect(soon.body.products.map((p: { slug: string }) => p.slug)).toEqual([slug]);
    expect(soon.body.summary.comingSoon).toBe(1);
    await admin.patch(`/api/admin/inventory/${slug}`).send({ availability: "inactive" });
    const off = await admin.get("/api/admin/inventory?status=inactive");
    expect(off.body.products.map((p: { slug: string }) => p.slug)).toEqual([slug]);
    expect(off.body.summary).toMatchObject({ inactive: 1, comingSoon: 0 });
  });

  it("the hover effect can be changed, but only to a known one", async () => {
    expect((await admin.patch(`/api/admin/inventory/${slug}`).send({ hoverEffect: "zoom" })).body.product.hoverEffect).toBe("zoom");
    expect((await admin.patch(`/api/admin/inventory/${slug}`).send({ hoverEffect: "wobble" })).status).toBe(400);
  });
});
