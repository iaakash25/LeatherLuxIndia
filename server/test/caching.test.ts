import crypto from "node:crypto";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { closePool, dbStats, getPool, query } from "../src/db/pool.js";
import { migrate } from "../src/db/migrate.js";
import { seed } from "../src/db/seed.js";
import { purgeAll } from "../src/lib/caches.js";

const ORIGIN = "https://shop.example.com";
const PASSWORD = "a-long-test-passphrase";
const BROWSER = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const app = createApp();

function client() {
  const agent = request.agent(app);
  const wrap = (m: "get" | "post" | "put" | "patch" | "delete") => (url: string) => agent[m](url).set("Origin", ORIGIN);
  return { agent, get: wrap("get"), post: wrap("post"), put: wrap("put"), patch: wrap("patch"), del: wrap("delete") };
}
async function signUp(email: string) {
  const c = client();
  expect((await c.post("/api/auth/register").send({ name: "Cache Tester", email, password: PASSWORD })).status).toBe(201);
  return c;
}
async function adminClient(email: string) {
  await signUp(email);
  await query("UPDATE users SET role = 'admin' WHERE email = $1", [email]);
  const c = client();
  expect((await c.post("/api/auth/login").send({ identifier: email, password: PASSWORD })).status).toBe(200);
  return c;
}

/** How many SQL statements `fn` sent to Postgres, optionally only those matching a pattern. */
async function queriesDuring(fn: () => Promise<unknown>, match?: RegExp): Promise<number> {
  const spy = vi.spyOn(getPool(), "query");
  try {
    await fn();
    return spy.mock.calls.filter(([text]) => !match || match.test(typeof text === "string" ? text : (text as { text: string }).text)).length;
  } finally {
    spy.mockRestore();
  }
}
const get = (url: string, headers: Record<string, string> = {}) => request(app).get(url).set(headers);

let admin: ReturnType<typeof client>;
beforeAll(async () => {
  await migrate();
  await seed();
  admin = await adminClient("cache-admin@example.com");
});
afterAll(async () => { await closePool(); });
beforeEach(() => { purgeAll(); }); // every test starts cold

describe("catalogue pages", () => {
  it("query the database once, then answer from memory", async () => {
    const first = await queriesDuring(() => get("/api/products?limit=100"));
    expect(first).toBe(2); // one count, one select
    const after = await queriesDuring(async () => { for (let i = 0; i < 25; i++) expect((await get("/api/products?limit=100")).status).toBe(200); });
    expect(after).toBe(0);
  });

  it("treats the same filters as the same page, whatever the parameter order", async () => {
    await get("/api/products?type=Wallets,Belts&colour=Ink&sort=price-asc");
    const n = await queriesDuring(async () => {
      await get("/api/products?sort=price-asc&colour=Ink&type=Belts,Wallets");
      await get("/api/products?colour=Ink&type=Wallets,Belts&sort=price-asc&utm_source=newsletter");
    });
    expect(n).toBe(0);
    expect(await queriesDuring(() => get("/api/products?type=Wallets&sort=price-asc"))).toBe(2); // different filters: its own entry
  });

  it("caches collections and single products, including 'not found'", async () => {
    expect(await queriesDuring(async () => { for (let i = 0; i < 5; i++) await get("/api/collections/gifts"); })).toBe(2);
    expect(await queriesDuring(async () => { for (let i = 0; i < 5; i++) expect((await get("/api/products/aria-top-handle")).status).toBe(200); })).toBe(1);
    expect(await queriesDuring(async () => { for (let i = 0; i < 5; i++) expect((await get("/api/products/no-such-piece")).status).toBe(404); })).toBe(1);
  });

  it("serves a burst of simultaneous visitors with a single load", async () => {
    const n = await queriesDuring(() => Promise.all(Array.from({ length: 40 }, () => get("/api/products?limit=100"))));
    expect(n).toBe(2);
  });

  it("lets browsers revalidate for free: ETag, then an empty 304 with no database work", async () => {
    const r = await get("/api/products?limit=100");
    const etag = r.headers["etag"] as string;
    expect(etag).toMatch(/^W\/"[0-9a-f]{20}"$/);
    expect(r.headers["cache-control"]).toBe("public, max-age=30, stale-while-revalidate=120");
    let again!: request.Response;
    expect(await queriesDuring(async () => { again = await get("/api/products?limit=100", { "If-None-Match": etag }); })).toBe(0);
    expect(again.status).toBe(304);
    expect(again.text).toBe("");
    expect((await get("/api/products?limit=100", { "If-None-Match": 'W/"something-else"' })).status).toBe(200);
  });
});

describe("what clears the catalogue cache", () => {
  it("an admin editing a product shows up on the very next request", async () => {
    const price = async () => (await get("/api/products/linea-bifold")).body.product.price as number;
    const before = await price();
    expect(await price()).toBe(before); // cached
    expect((await admin.patch("/api/admin/products/linea-bifold").send({ priceInr: before + 111 })).status).toBe(200);
    expect(await price()).toBe(before + 111);
    expect((await admin.patch("/api/admin/products/linea-bifold").send({ priceInr: before })).status).toBe(200);
    expect(await price()).toBe(before);
  });

  it("hiding a product removes it from lists and pages at once", async () => {
    const listed = async () => ((await get("/api/products?limit=100")).body.products as { slug: string }[]).some((p) => p.slug === "folio-pouch");
    expect(await listed()).toBe(true);
    await admin.patch("/api/admin/products/folio-pouch").send({ active: false });
    expect(await listed()).toBe(false);
    expect((await get("/api/products/folio-pouch")).status).toBe(404);
    await admin.patch("/api/admin/products/folio-pouch").send({ active: true });
    expect(await listed()).toBe(true);
  });

  it("selling the last pieces, and cancelling, update availability immediately", async () => {
    // Borrow a seeded product and put it back afterwards: the database is shared with other test files.
    const slug = "washbag";
    const original = (await query<{ stock_qty: number }>("SELECT stock_qty FROM products WHERE slug = $1", [slug])).rows[0]!.stock_qty;
    try {
      await query("UPDATE products SET stock_qty = 2 WHERE slug = $1", [slug]);
      purgeAll(); // direct SQL bypasses the API, so tell the cache
      const stock = async () => (await get(`/api/products/${slug}`)).body.product.stock as string;
      expect(await stock()).toBe("low");

      const shopper = await signUp("cache-shopper@example.com");
      const colour = (await get(`/api/products/${slug}`)).body.product.colours[0] as string;
      expect((await shopper.post("/api/cart/items").send({ slug, colour, qty: 2 })).status).toBe(201);
      const address = { name: "A B", phone: "9845012367", line1: "1 Road", city: "Pune", state: "Maharashtra", pincode: "411001" };
      const order = await shopper.post("/api/orders").send({ shippingAddress: address });
      expect(order.status).toBe(201);
      expect(await stock()).toBe("out"); // placing the order cleared the cache

      expect((await shopper.post(`/api/orders/${order.body.order.id}/cancel`).send()).status).toBe(200);
      expect(await stock()).toBe("low"); // so did cancelling
    } finally {
      await query("UPDATE products SET stock_qty = $2 WHERE slug = $1", [slug, original]);
      purgeAll();
    }
  });
});

describe("branding", () => {
  it("is read from the database once, however many pages are viewed", async () => {
    const n = await queriesDuring(async () => { for (let i = 0; i < 20; i++) expect((await get("/api/branding")).status).toBe(200); });
    expect(n).toBe(1);
  });
  it("revalidates with a 304 and no query", async () => {
    const r = await get("/api/branding");
    expect(r.headers["cache-control"]).toBe("no-cache");
    let again!: request.Response;
    expect(await queriesDuring(async () => { again = await get("/api/branding", { "If-None-Match": r.headers["etag"] as string }); })).toBe(0);
    expect(again.status).toBe(304);
  });
  it("shows a rename, a new logo and a removed logo immediately", async () => {
    await get("/api/branding"); // warm
    await admin.put("/api/admin/branding").send({ siteName: "Cached Co", siteSubtitle: "Test" });
    expect((await get("/api/branding")).body).toMatchObject({ siteName: "Cached Co", siteSubtitle: "Test", logoUrl: null });

    const up = await admin.put("/api/admin/branding/logo").set("Content-Type", "image/png").send(PNG);
    const url = up.body.branding.logoUrl as string;
    expect((await get("/api/branding")).body.logoUrl).toBe(url);
    expect(await queriesDuring(async () => { for (let i = 0; i < 10; i++) expect((await get(url)).status).toBe(200); })).toBe(1);
    const logo = await get(url);
    expect(Buffer.compare(logo.body, PNG)).toBe(0);
    expect((await get(url, { "If-None-Match": logo.headers["etag"] as string })).status).toBe(304);

    await admin.del("/api/admin/branding/logo");
    expect((await get("/api/branding")).body.logoUrl).toBeNull();
    expect((await get(url)).status).toBe(404);
    await admin.put("/api/admin/branding").send({ siteName: "Leather Lux", siteSubtitle: "India" });
  });
});

describe("visitor total", () => {
  const visit = (id: string) => request(app).post("/api/visits").set("Origin", ORIGIN).set("User-Agent", BROWSER).send({ visitorId: id });
  it("is counted once per few seconds, and a new visitor sees themselves straight away", async () => {
    const a = (await get("/api/visits")).body.total as number;
    expect(await queriesDuring(async () => { for (let i = 0; i < 10; i++) await get("/api/visits"); })).toBe(0);
    const r = await visit(crypto.randomUUID());
    expect(r.body.total).toBe(a + 1);
    expect((await get("/api/visits")).body.total).toBe(a + 1);
  });
});

describe("signed-in users", () => {
  it("cost one user lookup for a burst of calls, not one per call", async () => {
    const shopper = await signUp("burst@example.com");
    purgeAll();
    const lookups = await queriesDuring(async () => {
      await shopper.get("/api/auth/me");
      await shopper.get("/api/cart");
      await shopper.get("/api/wishlist");
      await shopper.get("/api/cart");
      await shopper.get("/api/auth/me");
    }, /FROM users WHERE id = \$1/);
    expect(lookups).toBe(1);
  });

  it("are still turned away at once after 'sign out everywhere'", async () => {
    const phone = await signUp("revoke@example.com");
    const laptop = client();
    await laptop.post("/api/auth/login").send({ identifier: "revoke@example.com", password: PASSWORD });
    expect((await laptop.get("/api/auth/me")).status).toBe(200); // now cached
    expect((await laptop.get("/api/cart")).status).toBe(200);
    expect((await phone.post("/api/auth/logout-all").send()).status).toBe(204);
    expect((await laptop.get("/api/auth/me")).status).toBe(401); // no waiting for the cache to expire
    expect((await laptop.get("/api/cart")).status).toBe(401);
  });

  it("are still turned away at once after a password change", async () => {
    const phone = await signUp("pwchange@example.com");
    const laptop = client();
    await laptop.post("/api/auth/login").send({ identifier: "pwchange@example.com", password: PASSWORD });
    expect((await laptop.get("/api/auth/me")).status).toBe(200);
    expect((await phone.post("/api/auth/change-password").send({ currentPassword: PASSWORD, newPassword: "another-long-passphrase" })).status).toBe(200);
    expect((await phone.get("/api/auth/me")).status).toBe(200); // this device stays signed in
    expect((await laptop.get("/api/auth/me")).status).toBe(401);
  });

  it("see a role changed directly in the database once the cache is purged", async () => {
    const c = await signUp("promoted@example.com");
    expect((await c.get("/api/admin/offers")).status).toBe(403); // cached as an ordinary user
    await query("UPDATE users SET role = 'admin' WHERE email = 'promoted@example.com'");
    purgeAll(); // what the admin "purge" button does; without it the change shows within AUTH_CACHE_SECONDS
    expect((await c.get("/api/admin/offers")).status).toBe(200);
  });
});

describe("admin cache report", () => {
  it("shows what is cached and how many database calls were avoided, and can purge", async () => {
    for (let i = 0; i < 6; i++) await get("/api/products?limit=100");
    const r = await admin.get("/api/admin/cache");
    expect(r.status).toBe(200);
    expect(typeof r.body.dbQueriesSinceStart).toBe("number");
    const catalogue = r.body.caches.find((c: { name: string }) => c.name === "catalogue");
    expect(catalogue).toMatchObject({ misses: expect.any(Number), hits: expect.any(Number) });
    expect(catalogue.hits).toBeGreaterThanOrEqual(5);
    // The rate is cumulative (these tests start cold on purpose), so check it agrees with the counts rather than a target.
    const served = catalogue.hits + catalogue.staleHits + catalogue.misses;
    expect(catalogue.hitRate).toBeCloseTo((catalogue.hits + catalogue.staleHits) / served, 2);

    expect((await admin.post("/api/admin/cache/purge").send()).body).toEqual({ purged: true });
    expect((await admin.get("/api/admin/cache")).body.caches.find((c: { name: string }) => c.name === "catalogue").entries).toBe(0);
  });
  it("is for admins only", async () => {
    const shopper = await signUp("cache-peek@example.com");
    expect((await shopper.get("/api/admin/cache")).status).toBe(403);
    expect((await shopper.post("/api/admin/cache/purge").send()).status).toBe(403);
    expect((await get("/api/admin/cache")).status).toBe(401);
  });
});

describe("pages that must stay live", () => {
  afterEach(() => vi.restoreAllMocks());
  it("never cache the bag, wishlist or orders", async () => {
    const c = await signUp("live@example.com");
    expect((await c.get("/api/cart")).headers["cache-control"]).toBe("no-store");
    expect((await c.post("/api/cart/items").send({ slug: "linea-bifold", colour: "Ink", qty: 1 })).status).toBe(201);
    expect((await c.get("/api/cart")).body.count).toBe(1); // reflects the change straight away
    expect((await c.get("/api/orders")).headers["cache-control"]).toBe("no-store");
    expect((await c.get("/api/wishlist")).headers["cache-control"]).toBe("no-store");
  });
  it("still check the database for readiness", async () => {
    expect(await queriesDuring(() => get("/api/health/ready"))).toBe(1);
    expect(await queriesDuring(() => get("/api/health/ready"))).toBe(1);
  });
  it("counted queries are reflected in the report", async () => {
    const before = dbStats.queries;
    await get("/api/health/ready");
    expect(dbStats.queries).toBe(before + 1);
  });
});
