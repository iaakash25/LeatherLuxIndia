import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { resetEnvCache } from "../src/config/env.js";
import { closePool, query } from "../src/db/pool.js";
import { migrate } from "../src/db/migrate.js";
import { seed } from "../src/db/seed.js";

const ORIGIN = "https://shop.example.com";
const address = { name: "Asha Rao", phone: "9845012367", line1: "12 MG Road", city: "Bengaluru", state: "Karnataka", pincode: "560001" };
const app = createApp();

/** Opens or closes ordering for the requests that follow (the setting is read per request). */
const setOrdersOpen = (open: boolean) => { process.env["ORDERS_OPEN"] = String(open); resetEnvCache(); };

const SLUG = "zz-test-closed";

beforeAll(async () => {
  await migrate();
  await seed();
  // A product of our own, so placing the order at the end does not change the stock of a sample product other tests rely on.
  await query(
    `INSERT INTO products (slug, name, type, gender, price_inr, colours, images, stock_qty, tagline, material, dimensions, rank)
     VALUES ($1, 'ZZ Test Closed', 'Wallets', 'unisex', 1500, '{Ink}', '{wallet}', 5, 'test', 'Leather', '', 902)`,
    [SLUG],
  );
});
afterEach(() => { setOrdersOpen(true); }); // back to the pinned test setting
afterAll(async () => {
  await query("DELETE FROM orders WHERE user_id IN (SELECT id FROM users WHERE email = 'closed-shop@example.com')");
  await query("DELETE FROM products WHERE slug = $1", [SLUG]);
  await closePool();
});

describe("before launch (ORDERS_OPEN=false)", () => {
  it("lets a shopper fill a bag but refuses the order, and keeps the bag", async () => {
    const agent = request.agent(app);
    const post = (url: string) => agent.post(url).set("Origin", ORIGIN);
    expect((await post("/api/auth/register").send({ name: "Closed Shop", email: "closed-shop@example.com", password: "a-long-test-passphrase" })).status).toBe(201);
    expect((await post("/api/cart/items").send({ slug: SLUG, colour: "Ink", qty: 1 })).status).toBe(201);

    setOrdersOpen(false);
    const refused = await post("/api/orders").send({ shippingAddress: address });
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe("orders_closed");
    expect(refused.body.error.message).toMatch(/bag is saved/i);

    const bag = await agent.get("/api/cart").set("Origin", ORIGIN);
    expect(bag.body.items).toHaveLength(1); // nothing was consumed
    const stock = (await query<{ stock_qty: number }>("SELECT stock_qty FROM products WHERE slug = $1", [SLUG])).rows[0]!.stock_qty;
    expect(stock).toBe(5);

    setOrdersOpen(true);
    const placed = await post("/api/orders").send({ shippingAddress: address });
    expect(placed.status).toBe(201);
    expect((await query<{ stock_qty: number }>("SELECT stock_qty FROM products WHERE slug = $1", [SLUG])).rows[0]!.stock_qty).toBe(4);
  });

  it("tells the storefront whether orders are open", async () => {
    setOrdersOpen(false);
    const closed = await request(app).get("/api/store-status");
    expect(closed.body).toEqual({ ordersOpen: false });
    expect(closed.headers["cache-control"]).toMatch(/max-age=30/);
    setOrdersOpen(true);
    expect((await request(app).get("/api/store-status")).body).toEqual({ ordersOpen: true });
  });

  it("is open by default, so nothing changes until someone closes it", async () => {
    delete process.env["ORDERS_OPEN"]; // not set at all (the next test's afterEach puts it back)
    resetEnvCache();
    expect((await request(app).get("/api/store-status")).body).toEqual({ ordersOpen: true });
  });
});
