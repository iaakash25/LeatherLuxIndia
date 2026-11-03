import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { closePool, query } from "../src/db/pool.js";
import { migrate } from "../src/db/migrate.js";
import { seed } from "../src/db/seed.js";

const ORIGIN = "https://shop.example.com";
const PASSWORD = "a-long-test-passphrase";
const app = createApp();

/** A browser-like client: keeps cookies and always sends the allow-listed Origin. */
function client() {
  const agent = request.agent(app);
  const wrap = (m: "get" | "post" | "put" | "patch" | "delete") => (url: string) => agent[m](url).set("Origin", ORIGIN);
  return { agent, get: wrap("get"), post: wrap("post"), put: wrap("put"), patch: wrap("patch"), del: wrap("delete") };
}

async function signUp(email: string, name = "Test Person") {
  const c = client();
  const res = await c.post("/api/auth/register").send({ name, email, password: PASSWORD });
  expect(res.status).toBe(201);
  return c;
}

const address = { name: "Asha Rao", phone: "9845012367", line1: "12 MG Road", city: "Bengaluru", state: "Karnataka", pincode: "560001" };
const cookieHeader = (res: request.Response, name: string) => (res.headers["set-cookie"] as unknown as string[] | undefined)?.find((c) => c.startsWith(`${name}=`));

beforeAll(async () => {
  await migrate();
  await seed();
});
afterAll(async () => { await closePool(); });

describe("database", () => {
  it("migrations are idempotent and the catalogue seeds cleanly", async () => {
    expect(await migrate()).toEqual([]);
    expect(await seed()).toBe(22);
    expect((await request(app).get("/api/health/ready")).body.status).toBe("ready");
  });
});

describe("catalogue", () => {
  it("lists, filters, sorts and paginates", async () => {
    const all = await request(app).get("/api/products?limit=100");
    expect(all.body.total).toBe(22);
    expect(all.body.products[0]).toMatchObject({ slug: "aria-top-handle", price: 14990, stock: "in" });

    const gifts = await request(app).get("/api/collections/gifts");
    expect(gifts.body.collection.title).toBe("The Gift Edit");
    expect(gifts.body.products.every((p: { gift: boolean }) => p.gift)).toBe(true);

    const men = await request(app).get("/api/collections/men?sort=price-asc");
    const prices = men.body.products.map((p: { price: number }) => p.price);
    expect(prices).toEqual([...prices].sort((a: number, b: number) => a - b));
    expect(men.body.products.some((p: { gender: string }) => p.gender === "women")).toBe(false);

    const wallets = await request(app).get("/api/products?type=Wallets,Belts&colour=Cognac");
    expect(wallets.body.products.map((p: { slug: string }) => p.slug).sort()).toEqual(["arc-belt-35", "linea-bifold"]);

    const q = await request(app).get("/api/products?q=oxblood%20mini");
    expect(q.body.products.map((p: { slug: string }) => p.slug)).toEqual(["solenne-mini"]);

    const inStock = await request(app).get("/api/products?inStock=true&limit=100");
    expect(inStock.body.total).toBe(21);

    const page = await request(app).get("/api/products?limit=5&offset=5");
    expect(page.body.products).toHaveLength(5);
    expect(page.body.total).toBe(22);
  });
  it("treats search input as data, not SQL or LIKE wildcards", async () => {
    const inj = await request(app).get("/api/products?q=' OR 1=1 --");
    expect(inj.status).toBe(200);
    expect(inj.body.total).toBe(0);
    expect((await request(app).get("/api/products?q=%25")).body.total).toBe(0);
  });
  it("returns 404 / 400 for bad lookups", async () => {
    expect((await request(app).get("/api/products/no-such-thing")).status).toBe(404);
    expect((await request(app).get("/api/products/BAD%20SLUG")).status).toBe(400);
    expect((await request(app).get("/api/collections/nope")).status).toBe(404);
    expect((await request(app).get("/api/products?sort=;drop")).status).toBe(400);
  });
  it("returns product detail with derived stock status", async () => {
    const r = await request(app).get("/api/products/halden-satchel");
    expect(r.body.product).toMatchObject({ stock: "low", name: "Halden Saddle Crossbody" });
    expect((await request(app).get("/api/products/travel-card-holder")).body.product.stock).toBe("out");
  });
});

describe("auth", () => {
  it("registers, sets hardened cookies, and never returns the hash", async () => {
    const c = client();
    const res = await c.post("/api/auth/register").send({ name: "Asha", email: "Asha@Example.com", password: PASSWORD });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ email: "asha@example.com", role: "user" });
    expect(JSON.stringify(res.body)).not.toMatch(/hash|scrypt/);
    const at = cookieHeader(res, "llx_at")!;
    const rt = cookieHeader(res, "llx_rt")!;
    expect(at).toMatch(/HttpOnly/);
    expect(at).toMatch(/SameSite=Lax/);
    expect(rt).toMatch(/Path=\/api\/auth/);
    expect(rt).toMatch(/HttpOnly/);
    expect((await c.get("/api/auth/me")).body.user.email).toBe("asha@example.com");
    const stored = await query<{ password_hash: string }>("SELECT password_hash FROM users WHERE email = 'asha@example.com'");
    expect(stored.rows[0]!.password_hash).toMatch(/^scrypt\$/);
    expect(stored.rows[0]!.password_hash).not.toContain(PASSWORD);
  });
  it("rejects duplicates, weak passwords, bad emails and role injection", async () => {
    const c = client();
    expect((await c.post("/api/auth/register").send({ name: "Dup", email: "asha@example.com", password: PASSWORD })).status).toBe(409);
    expect((await c.post("/api/auth/register").send({ name: "X", email: "x1@example.com", password: "short" })).status).toBe(400);
    expect((await c.post("/api/auth/register").send({ name: "X", email: "x1@example.com", password: "password123" })).status).toBe(400);
    expect((await c.post("/api/auth/register").send({ name: "X", email: "not-an-email", password: PASSWORD })).status).toBe(400);
    const sneaky = await c.post("/api/auth/register").send({ name: "Mallory", email: "mallory@example.com", password: PASSWORD, role: "admin" });
    expect(sneaky.body.user.role).toBe("user");
  });
  it("logs in with a generic error for unknown email and wrong password", async () => {
    const c = client();
    const a = await c.post("/api/auth/login").send({ email: "nobody@example.com", password: PASSWORD });
    const b = await c.post("/api/auth/login").send({ email: "asha@example.com", password: "wrong-password-1" });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.error).toEqual(b.body.error);
    expect((await c.post("/api/auth/login").send({ email: "ASHA@example.com", password: PASSWORD })).status).toBe(200);
  });
  it("locks an account after repeated failures, even for the right password", async () => {
    await signUp("locky@example.com");
    const c = client();
    for (let i = 0; i < 10; i++) await c.post("/api/auth/login").send({ email: "locky@example.com", password: "wrong-password-1" });
    const res = await c.post("/api/auth/login").send({ email: "locky@example.com", password: PASSWORD });
    expect(res.status).toBe(401);
    await query("UPDATE users SET locked_until = NULL, failed_logins = 0 WHERE email = 'locky@example.com'");
    expect((await c.post("/api/auth/login").send({ email: "locky@example.com", password: PASSWORD })).status).toBe(200);
  });
  it("blocks CSRF: cookie-authenticated writes need an allow-listed Origin", async () => {
    const c = await signUp("csrf@example.com");
    const noOrigin = await c.agent.post("/api/cart/items").send({ slug: "linea-bifold", colour: "Ink", qty: 1 });
    expect(noOrigin.status).toBe(403);
    const evil = await c.agent.post("/api/cart/items").set("Origin", "https://evil.example").send({ slug: "linea-bifold", colour: "Ink", qty: 1 });
    expect(evil.status).toBe(403);
    expect((await c.post("/api/cart/items").send({ slug: "linea-bifold", colour: "Ink", qty: 1 })).status).toBe(201);
  });
  it("rejects forged and tampered session cookies", async () => {
    const res = await request(app).get("/api/auth/me").set("Cookie", "llx_at=eyJhbGciOiJub25lIn0.eyJzdWIiOiJ4In0.");
    expect(res.status).toBe(401);
  });
  it("rotates refresh tokens and revokes the family when an old one is replayed", async () => {
    await signUp("rotate@example.com");
    const login = await client().post("/api/auth/login").send({ email: "rotate@example.com", password: PASSWORD });
    const oldRefresh = cookieHeader(login, "llx_rt")!.split(";")[0]!;

    const r1 = await request(app).post("/api/auth/refresh").set("Origin", ORIGIN).set("Cookie", oldRefresh);
    expect(r1.status).toBe(200);
    const newRefresh = cookieHeader(r1, "llx_rt")!.split(";")[0]!;
    expect(newRefresh).not.toBe(oldRefresh);

    // immediate replay = benign race: rejected but the family survives
    const race = await request(app).post("/api/auth/refresh").set("Origin", ORIGIN).set("Cookie", oldRefresh);
    expect(race.status).toBe(401);
    expect((await request(app).post("/api/auth/refresh").set("Origin", ORIGIN).set("Cookie", newRefresh)).status).toBe(200);

    // replay after the grace window = theft: whole family dies
    await query("UPDATE refresh_tokens SET revoked_at = now() - interval '1 minute' WHERE revoked_at IS NOT NULL");
    const reuse = await request(app).post("/api/auth/refresh").set("Origin", ORIGIN).set("Cookie", oldRefresh);
    expect(reuse.status).toBe(401);
    // the legitimate holder's newest token from that family is dead too
    expect((await request(app).post("/api/auth/refresh").set("Origin", ORIGIN).set("Cookie", newRefresh)).status).toBe(401);
    const audit = await query("SELECT 1 FROM audit_log WHERE action = 'refresh_token_reuse'");
    expect(audit.rowCount).toBeGreaterThan(0);
  });
  it("logout revokes the session server-side", async () => {
    const c = await signUp("bye@example.com");
    expect((await c.post("/api/auth/logout").send()).status).toBe(204);
    const live = await query("SELECT 1 FROM refresh_tokens rt JOIN users u ON u.id = rt.user_id WHERE u.email = 'bye@example.com' AND rt.revoked_at IS NULL");
    expect(live.rowCount).toBe(0);
  });
  it("logout-all and change-password invalidate other devices immediately", async () => {
    const phone = await signUp("multi@example.com");
    const laptop = client();
    await laptop.post("/api/auth/login").send({ email: "multi@example.com", password: PASSWORD });
    expect((await laptop.get("/api/auth/me")).status).toBe(200);

    const bad = await phone.post("/api/auth/change-password").send({ currentPassword: "nope-nope-nope", newPassword: "another-long-passphrase" });
    expect(bad.status).toBe(401);
    const ok = await phone.post("/api/auth/change-password").send({ currentPassword: PASSWORD, newPassword: "another-long-passphrase" });
    expect(ok.status).toBe(200);
    expect((await phone.get("/api/auth/me")).status).toBe(200); // this device stays signed in
    expect((await laptop.get("/api/auth/me")).status).toBe(401); // others are kicked
    expect((await client().post("/api/auth/login").send({ email: "multi@example.com", password: PASSWORD })).status).toBe(401);

    expect((await phone.post("/api/auth/logout-all").send()).status).toBe(204);
    expect((await phone.get("/api/auth/me")).status).toBe(401);
  });
});

describe("cart & wishlist", () => {
  it("validates variants, clamps quantity and isolates users", async () => {
    const c = await signUp("cart@example.com");
    expect((await c.post("/api/cart/items").send({ slug: "linea-bifold", colour: "Pink", qty: 1 })).status).toBe(400);
    expect((await c.post("/api/cart/items").send({ slug: "arc-belt-35", colour: "Ink", qty: 1 })).status).toBe(400); // size required
    expect((await c.post("/api/cart/items").send({ slug: "linea-bifold", colour: "Ink", size: "90", qty: 1 })).status).toBe(400); // no sizes
    expect((await c.post("/api/cart/items").send({ slug: "travel-card-holder", colour: "Ink", qty: 1 })).status).toBe(400); // out of stock
    expect((await c.post("/api/cart/items").send({ slug: "nope", colour: "Ink", qty: 1 })).status).toBe(400);
    expect((await c.post("/api/cart/items").send({ slug: "linea-bifold", colour: "Ink", qty: 99 })).status).toBe(400);

    await c.post("/api/cart/items").send({ slug: "arc-belt-35", colour: "Ink", size: "90", qty: 2 });
    const r = await c.post("/api/cart/items").send({ slug: "arc-belt-35", colour: "Ink", size: "90", qty: 9 });
    expect(r.body.items).toHaveLength(1);
    expect(r.body.items[0]).toMatchObject({ qty: 10, unitPrice: 3490, lineTotal: 34900, size: "90" });
    expect(r.body).toMatchObject({ subtotal: 34900, shipping: 0, total: 34900 });

    const id = r.body.items[0].id;
    const patched = await c.patch(`/api/cart/items/${id}`).send({ qty: 3 });
    expect(patched.body.count).toBe(3);

    const other = await signUp("cart-other@example.com");
    expect((await other.patch(`/api/cart/items/${id}`).send({ qty: 1 })).status).toBe(404);
    expect((await other.del(`/api/cart/items/${id}`)).status).toBe(404);
    expect((await other.get("/api/cart")).body.items).toEqual([]);
    expect((await c.patch("/api/cart/items/not-a-uuid").send({ qty: 1 })).status).toBe(400);

    expect((await c.del(`/api/cart/items/${id}`)).body.items).toEqual([]);
  });
  it("merges a guest bag, skipping invalid lines", async () => {
    const c = await signUp("merge@example.com");
    const r = await c.post("/api/cart/merge").send({
      items: [
        { slug: "linea-bifold", colour: "Ink", qty: 1 },
        { slug: "ghost", colour: "Ink", qty: 1 },
        { slug: "travel-card-holder", colour: "Ink", qty: 1 },
      ],
    });
    expect(r.body.items).toHaveLength(1);
    expect(r.body).toMatchObject({ subtotal: 2490, shipping: 150, total: 2640 }); // ₹10 under the free-shipping threshold
    expect(r.body.skipped.sort()).toEqual(["ghost", "travel-card-holder"]);
  });
  it("manages the wishlist idempotently", async () => {
    const c = await signUp("wish@example.com");
    await c.put("/api/wishlist/aria-top-handle");
    const r = await c.put("/api/wishlist/aria-top-handle");
    expect(r.body.slugs).toEqual(["aria-top-handle"]);
    expect((await c.put("/api/wishlist/ghost")).body.slugs).toEqual(["aria-top-handle"]);
    const m = await c.post("/api/wishlist/merge").send({ slugs: ["linea-bifold", "aria-top-handle", "ghost"] });
    expect(m.body.slugs.sort()).toEqual(["aria-top-handle", "linea-bifold"]);
    expect((await c.del("/api/wishlist/aria-top-handle")).body.slugs).toEqual(["linea-bifold"]);
  });
});

describe("orders", () => {
  const stock = async (slug: string) => (await query<{ stock_qty: number }>("SELECT stock_qty FROM products WHERE slug = $1", [slug])).rows[0]!.stock_qty;

  it("prices from the database, decrements stock once, is idempotent, and empties the bag", async () => {
    const c = await signUp("buyer@example.com");
    expect((await c.post("/api/orders").send({ shippingAddress: address })).status).toBe(400); // empty bag

    await c.post("/api/cart/items").send({ slug: "plinth-card-case", colour: "Ink", qty: 2 });
    const before = await stock("plinth-card-case");
    const bad = await c.post("/api/orders").send({ shippingAddress: { ...address, pincode: "12" } });
    expect(bad.status).toBe(400);

    const key = "idem-key-12345678";
    const o1 = await c.post("/api/orders").set("Idempotency-Key", key).send({ shippingAddress: address, total: 1 });
    expect(o1.status).toBe(201);
    expect(o1.body.order).toMatchObject({ status: "pending", paymentStatus: "unpaid", subtotal: 3580, shipping: 0, total: 3580 });
    expect(o1.body.order.orderNumber).toMatch(/^LLX-\d{8}-[A-Z2-9]{6}$/);
    expect(await stock("plinth-card-case")).toBe(before - 2);
    expect((await c.get("/api/cart")).body.items).toEqual([]);

    const o2 = await c.post("/api/orders").set("Idempotency-Key", key).send({ shippingAddress: address });
    expect(o2.status).toBe(200);
    expect(o2.body.order.id).toBe(o1.body.order.id);
    expect(await stock("plinth-card-case")).toBe(before - 2);

    expect((await c.get("/api/orders")).body.orders).toHaveLength(1);
    expect((await c.get(`/api/orders/${o1.body.order.id}`)).body.order.items[0]).toMatchObject({ slug: "plinth-card-case", qty: 2, unitPrice: 1790 });
    const snoop = await signUp("snoop@example.com");
    expect((await snoop.get(`/api/orders/${o1.body.order.id}`)).status).toBe(404);
  });
  it("charges flat shipping under the free threshold", async () => {
    const c = await signUp("ship@example.com");
    await c.post("/api/cart/items").send({ slug: "coin-pouch", colour: "Ink", qty: 1 });
    const o = await c.post("/api/orders").send({ shippingAddress: address });
    expect(o.body.order).toMatchObject({ subtotal: 990, shipping: 150, total: 1140 });
  });
  it("never oversells", async () => {
    await query("UPDATE products SET stock_qty = 3 WHERE slug = 'solenne-mini'");
    const a = await signUp("race-a@example.com");
    const b = await signUp("race-b@example.com");
    await a.post("/api/cart/items").send({ slug: "solenne-mini", colour: "Oxblood", qty: 2 });
    await b.post("/api/cart/items").send({ slug: "solenne-mini", colour: "Oxblood", qty: 2 });
    const [ra, rb] = await Promise.all([a.post("/api/orders").send({ shippingAddress: address }), b.post("/api/orders").send({ shippingAddress: address })]);
    expect([ra.status, rb.status].sort()).toEqual([201, 409]);
    expect(await stock("solenne-mini")).toBe(1);
    // the loser keeps their bag
    const loser = ra.status === 409 ? a : b;
    expect((await loser.get("/api/cart")).body.items).toHaveLength(1);
  });
  it("lets customers cancel (restocking) but not after shipping", async () => {
    const c = await signUp("cancel@example.com");
    await c.post("/api/cart/items").send({ slug: "tessera-key-loop", colour: "Ink", qty: 3 });
    const before = await stock("tessera-key-loop");
    const o = (await c.post("/api/orders").send({ shippingAddress: address })).body.order;
    expect(await stock("tessera-key-loop")).toBe(before - 3);
    const cancelled = await c.post(`/api/orders/${o.id}/cancel`).send();
    expect(cancelled.body.order.status).toBe("cancelled");
    expect(await stock("tessera-key-loop")).toBe(before);
    expect((await c.post(`/api/orders/${o.id}/cancel`).send()).status).toBe(200); // idempotent
    expect(await stock("tessera-key-loop")).toBe(before);

    await c.post("/api/cart/items").send({ slug: "tessera-key-loop", colour: "Ink", qty: 1 });
    const o2 = (await c.post("/api/orders").send({ shippingAddress: address })).body.order;
    await query("UPDATE orders SET status = 'shipped' WHERE id = $1", [o2.id]);
    expect((await c.post(`/api/orders/${o2.id}/cancel`).send()).status).toBe(409);
  });
});

describe("admin", () => {
  it("is closed to customers and enforces the order state machine for admins", async () => {
    const cust = await signUp("plain@example.com");
    expect((await cust.get("/api/admin/orders")).status).toBe(403);
    expect((await cust.patch("/api/admin/products/linea-bifold").send({ stockQty: 999 })).status).toBe(403);

    const admin = await signUp("boss@example.com");
    await query("UPDATE users SET role = 'admin', token_version = token_version + 1 WHERE email = 'boss@example.com'");
    expect((await admin.get("/api/admin/orders")).status).toBe(401); // stale token after role change
    await admin.post("/api/auth/login").send({ email: "boss@example.com", password: PASSWORD });

    await cust.post("/api/cart/items").send({ slug: "folio-pouch", colour: "Ink", qty: 1 });
    const order = (await cust.post("/api/orders").send({ shippingAddress: address })).body.order;

    expect((await admin.get("/api/admin/orders?status=pending")).body.orders.some((o: { id: string }) => o.id === order.id)).toBe(true);
    expect((await admin.patch(`/api/admin/orders/${order.id}`).send({ status: "delivered" })).status).toBe(409);
    expect((await admin.patch(`/api/admin/orders/${order.id}`).send({ status: "confirmed", paymentStatus: "paid" })).body.order).toMatchObject({ status: "confirmed", paymentStatus: "paid" });
    expect((await admin.patch(`/api/admin/orders/${order.id}`).send({ status: "shipped" })).body.order.status).toBe("shipped");
    expect((await admin.patch(`/api/admin/orders/${order.id}`).send({})).status).toBe(400);

    const p = await admin.patch("/api/admin/products/folio-pouch").send({ stockQty: 7, priceInr: 4590 });
    expect(p.body.product).toMatchObject({ price: 4590, stock: "in" });
    await admin.patch("/api/admin/products/folio-pouch").send({ active: false });
    expect((await request(app).get("/api/products/folio-pouch")).status).toBe(404);
    await admin.patch("/api/admin/products/folio-pouch").send({ active: true });
  });
});

describe("newsletter", () => {
  it("answers identically for new and existing subscribers", async () => {
    const a = await request(app).post("/api/newsletter").send({ email: "Fan@Example.com" });
    const b = await request(app).post("/api/newsletter").send({ email: "fan@example.com" });
    expect(a.status).toBe(202);
    expect(b.status).toBe(202);
    expect(a.body).toEqual(b.body);
    expect((await query("SELECT 1 FROM newsletter_subscribers WHERE email = 'fan@example.com'")).rowCount).toBe(1);
    expect((await request(app).post("/api/newsletter").send({ email: "nope" })).status).toBe(400);
  });
});
