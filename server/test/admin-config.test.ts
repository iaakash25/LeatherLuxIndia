import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { closePool, query } from "../src/db/pool.js";
import { migrate } from "../src/db/migrate.js";
import { seed } from "../src/db/seed.js";

const ORIGIN = "https://shop.example.com";
const PASSWORD = "a-long-test-passphrase";
const app = createApp();

function client() {
  const agent = request.agent(app);
  const wrap = (m: "get" | "post" | "put" | "patch" | "delete") => (url: string) => agent[m](url).set("Origin", ORIGIN);
  return { agent, get: wrap("get"), post: wrap("post"), put: wrap("put"), patch: wrap("patch"), del: wrap("delete") };
}
async function signUp(email: string) {
  const c = client();
  expect((await c.post("/api/auth/register").send({ name: "Test Person", email, password: PASSWORD })).status).toBe(201);
  return c;
}
/** A signed-in admin: register, promote in the database, then sign in again so the session carries the new role. */
async function adminClient(email: string, username?: string) {
  await signUp(email);
  await query("UPDATE users SET role = 'admin', username = $2 WHERE email = $1", [email, username ?? null]);
  const c = client();
  expect((await c.post("/api/auth/login").send({ identifier: email, password: PASSWORD })).status).toBe(200);
  return c;
}

// 1×1 transparent PNG
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0x24, 0, 0, 0]), Buffer.from("WEBP"), Buffer.alloc(32)]);

let admin: ReturnType<typeof client>;

beforeAll(async () => {
  await migrate();
  await seed();
  admin = await adminClient("config-admin@example.com", "lli_admin_test");
});
afterAll(async () => { await closePool(); });

describe("roles and usernames", () => {
  it("has admin and user roles, and every account references one", async () => {
    const r = await admin.get("/api/admin/roles");
    expect(r.status).toBe(200);
    const byName = Object.fromEntries(r.body.roles.map((x: { name: string; users: number }) => [x.name, x.users]));
    expect(Object.keys(byName).sort()).toEqual(["admin", "user"]);
    expect(byName["admin"]).toBeGreaterThanOrEqual(1);
    await expect(query("UPDATE users SET role = 'wizard' WHERE email = 'config-admin@example.com'")).rejects.toMatchObject({ code: "23503" });
  });
  it("registers shoppers as 'user'", async () => {
    const c = client();
    const res = await c.post("/api/auth/register").send({ name: "Pat", email: "pat-user@example.com", password: PASSWORD });
    expect(res.body.user.role).toBe("user");
  });
  it("signs in by username or email, case-insensitively, with identifier or legacy email key", async () => {
    for (const body of [
      { identifier: "LLI_Admin_Test", password: PASSWORD },
      { identifier: "config-admin@example.com", password: PASSWORD },
      { email: "config-admin@example.com", password: PASSWORD },
    ]) {
      const res = await client().post("/api/auth/login").send(body);
      expect(res.status).toBe(200);
      expect(res.body.user).toMatchObject({ role: "admin", username: "lli_admin_test" });
    }
    const bad = await client().post("/api/auth/login").send({ identifier: "lli_admin_test", password: "wrong-password-1" });
    expect(bad.status).toBe(401);
    expect((await client().post("/api/auth/login").send({ password: PASSWORD })).status).toBe(400);
  });
  it("keeps usernames unique and well-formed", async () => {
    await signUp("second@example.com");
    await expect(query("UPDATE users SET username = 'lli_admin_test' WHERE email = 'second@example.com'")).rejects.toMatchObject({ code: "23505" });
    await expect(query("UPDATE users SET username = 'Bad Name!' WHERE email = 'second@example.com'")).rejects.toMatchObject({ code: "23514" });
  });
});

describe("access control", () => {
  it("shuts shoppers and anonymous visitors out of every config endpoint", async () => {
    const shopper = await signUp("shopper-acl@example.com");
    const paths = ["/api/admin/roles", "/api/admin/branding", "/api/admin/offers", "/api/admin/loyalty", "/api/admin/discounts"];
    for (const p of paths) {
      expect((await shopper.get(p)).status).toBe(403);
      expect((await request(app).get(p)).status).toBe(401);
    }
    expect((await shopper.put("/api/admin/branding").send({ siteName: "Hacked" })).status).toBe(403);
    expect((await shopper.post("/api/admin/offers").send({ name: "x", kind: "free_shipping" })).status).toBe(403);
    expect((await shopper.put("/api/admin/branding/logo").set("Content-Type", "image/png").send(PNG)).status).toBe(403);
  });
});

describe("branding", () => {
  it("serves the default name publicly", async () => {
    const r = await request(app).get("/api/branding");
    expect(r.body).toEqual({ siteName: "Leather Lux", siteSubtitle: "India", logoUrl: null });
    expect(r.headers["cache-control"]).toBe("no-cache"); // revalidated each time, so renames show immediately
    expect((await request(app).get("/api/branding/logo")).status).toBe(404);
  });
  it("lets an admin rename the store, and validates the input", async () => {
    const ok = await admin.put("/api/admin/branding").send({ siteName: "  Maison Cuir ", siteSubtitle: "Paris" });
    expect(ok.status).toBe(200);
    expect((await request(app).get("/api/branding")).body).toMatchObject({ siteName: "Maison Cuir", siteSubtitle: "Paris" });
    expect((await admin.put("/api/admin/branding").send({ siteName: "   " })).status).toBe(400);
    expect((await admin.put("/api/admin/branding").send({ siteName: "<script>alert(1)</script>" })).status).toBe(400);
    expect((await admin.put("/api/admin/branding").send({ siteName: "x".repeat(61) })).status).toBe(400);
    expect((await admin.put("/api/admin/branding").send({ siteName: "Maison Cuir" })).body.branding.siteSubtitle).toBe("");
  });
  it("accepts PNG, JPEG and WebP logos and serves them cross-origin with a versioned URL", async () => {
    let version = 0;
    for (const [type, bytes] of [["image/png", PNG], ["image/jpeg", JPEG], ["image/webp", WEBP]] as const) {
      const up = await admin.put("/api/admin/branding/logo").set("Content-Type", type).send(bytes);
      expect(up.status).toBe(200);
      const url: string = up.body.branding.logoUrl;
      const v = Number(url.split("v=")[1]);
      expect(v).toBeGreaterThan(version);
      version = v;
      const pub = await request(app).get(url);
      expect(pub.status).toBe(200);
      expect(pub.headers["content-type"]).toContain(type);
      expect(pub.headers["cross-origin-resource-policy"]).toBe("cross-origin");
      expect(pub.headers["cache-control"]).toContain("immutable");
      expect(Buffer.compare(pub.body, bytes)).toBe(0);
    }
    expect((await request(app).get("/api/branding")).body.logoUrl).toBe(`/api/branding/logo?v=${version}`);
  });
  it("rejects wrong types, disguised files and oversized uploads", async () => {
    const put = (type: string, body: Buffer | string) => admin.put("/api/admin/branding/logo").set("Content-Type", type).send(body);
    expect((await put("image/svg+xml", "<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>")).status).toBe(415);
    expect((await put("application/json", "{}")).status).toBe(415);
    expect((await put("image/png", "<html>not an image</html>")).status).toBe(400);
    expect((await put("image/jpeg", PNG)).status).toBe(400); // PNG bytes declared as JPEG
    const big = Buffer.concat([PNG, Buffer.alloc(1_200_000)]);
    expect((await put("image/png", big)).status).toBe(413);
  });
  it("removes the logo", async () => {
    const r = await admin.del("/api/admin/branding/logo");
    expect(r.body.branding.logoUrl).toBeNull();
    expect((await request(app).get("/api/branding/logo")).status).toBe(404);
  });
});

const offer = (over: Record<string, unknown> = {}) => ({ name: "Festive 10", kind: "percentage", value: 10, ...over });

describe("offers", () => {
  it("creates automatic and coupon offers and classifies them for discount rules", async () => {
    const auto = await admin.post("/api/admin/offers").send(offer());
    expect(auto.status).toBe(201);
    expect(auto.body.offer).toMatchObject({ kind: "percentage", value: 10, code: null, scope: "all", state: "live", combinesAs: "offer", active: true });

    const coupon = await admin.post("/api/admin/offers").send(offer({ name: "Welcome", code: " welcome-100 ", kind: "fixed", value: 100, minOrderInr: 999, perUserLimit: 1, usageLimit: 500, priority: 5 }));
    expect(coupon.status).toBe(201);
    expect(coupon.body.offer).toMatchObject({ code: "WELCOME-100", combinesAs: "coupon", minOrderInr: 999, perUserLimit: 1, usageLimit: 500, priority: 5 });

    const ship = await admin.post("/api/admin/offers").send({ name: "Free shipping week", kind: "free_shipping" });
    expect(ship.body.offer).toMatchObject({ value: 0, combinesAs: "free_shipping" });
  });
  it("rejects invalid combinations of fields", async () => {
    const bad = async (body: Record<string, unknown>) => (await admin.post("/api/admin/offers").send(body)).status;
    expect(await bad(offer({ value: 150 }))).toBe(400);
    expect(await bad(offer({ value: 0 }))).toBe(400);
    expect(await bad(offer({ kind: "fixed", value: 0 }))).toBe(400);
    expect(await bad({ name: "x", kind: "free_shipping", value: 5 })).toBe(400);
    expect(await bad(offer({ kind: "fixed", value: 50, maxDiscountInr: 10 }))).toBe(400);
    expect(await bad(offer({ code: "no" }))).toBe(400);
    expect(await bad(offer({ name: "" }))).toBe(400);
    expect(await bad(offer({ scope: "product", scopeValues: [] }))).toBe(400);
    expect(await bad(offer({ scope: "all", scopeValues: ["aria-top-handle"] }))).toBe(400);
    expect(await bad(offer({ startsAt: "2030-02-01T00:00:00Z", endsAt: "2030-01-01T00:00:00Z" }))).toBe(400);
    expect(await bad(offer({ startsAt: "not a date" }))).toBe(400);
  });
  it("checks that scoped collections and products exist", async () => {
    expect((await admin.post("/api/admin/offers").send(offer({ scope: "collection", scopeValues: ["gifts", "men"] }))).status).toBe(201);
    expect((await admin.post("/api/admin/offers").send(offer({ scope: "collection", scopeValues: ["nope"] }))).status).toBe(400);
    expect((await admin.post("/api/admin/offers").send(offer({ scope: "product", scopeValues: ["linea-bifold"] }))).status).toBe(201);
    expect((await admin.post("/api/admin/offers").send(offer({ scope: "product", scopeValues: ["ghost-product"] }))).status).toBe(400);
  });
  it("keeps coupon codes unique (case-insensitively)", async () => {
    expect((await admin.post("/api/admin/offers").send(offer({ code: "ONCE-ONLY" }))).status).toBe(201);
    const dup = await admin.post("/api/admin/offers").send(offer({ code: "once-only" }));
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("code_taken");
  });
  it("reports scheduled, expired and disabled states, and supports update, toggle and delete", async () => {
    const make = async (over: Record<string, unknown>) => (await admin.post("/api/admin/offers").send(offer(over))).body.offer;
    const future = await make({ name: "Future", startsAt: "2099-01-01T00:00:00Z" });
    const past = await make({ name: "Past", startsAt: "2000-01-01T00:00:00Z", endsAt: "2000-02-01T00:00:00Z" });
    const off = await make({ name: "Off", active: false });
    expect([future.state, past.state, off.state]).toEqual(["scheduled", "expired", "disabled"]);

    const upd = await admin.put(`/api/admin/offers/${off.id}`).send(offer({ name: "Off renamed", active: true, value: 25 }));
    expect(upd.body.offer).toMatchObject({ name: "Off renamed", value: 25, state: "live" });
    expect((await admin.patch(`/api/admin/offers/${off.id}`).send({ active: false })).body.offer.state).toBe("disabled");
    expect((await admin.get(`/api/admin/offers/${off.id}`)).body.offer.name).toBe("Off renamed");

    const list = (await admin.get("/api/admin/offers")).body.offers as { id: string; priority: number }[];
    expect(list.length).toBeGreaterThanOrEqual(8);
    const priorities = list.map((o) => o.priority);
    expect(priorities).toEqual([...priorities].sort((a, b) => b - a)); // highest priority first

    expect((await admin.del(`/api/admin/offers/${off.id}`)).status).toBe(204);
    expect((await admin.del(`/api/admin/offers/${off.id}`)).status).toBe(404);
    expect((await admin.get(`/api/admin/offers/${off.id}`)).status).toBe(404);
    expect((await admin.get("/api/admin/offers/not-a-uuid")).status).toBe(400);
  });
});

describe("loyalty", () => {
  it("starts disabled with sensible defaults, and saves changes", async () => {
    const g = await admin.get("/api/admin/loyalty");
    expect(g.body.settings).toMatchObject({ enabled: false, earnPointsPer100Inr: 1, redeemInrPer100Points: 10, minPointsToRedeem: 100, maxRedeemPctOfOrder: 50, pointsExpiryDays: null, signupBonusPoints: 0 });
    expect(g.body.tiers).toEqual([]);

    const body = { enabled: true, earnPointsPer100Inr: 5, redeemInrPer100Points: 20, minPointsToRedeem: 250, maxRedeemPctOfOrder: 30, pointsExpiryDays: 365, signupBonusPoints: 100 };
    const put = await admin.put("/api/admin/loyalty").send(body);
    expect(put.status).toBe(200);
    expect(put.body.settings).toMatchObject(body);
    expect((await admin.get("/api/admin/loyalty")).body.settings).toMatchObject(body);
    expect((await admin.put("/api/admin/loyalty").send({ ...body, maxRedeemPctOfOrder: 0 })).status).toBe(400);
    expect((await admin.put("/api/admin/loyalty").send({ ...body, redeemInrPer100Points: 0 })).status).toBe(400);
    expect((await admin.put("/api/admin/loyalty").send({ ...body, enabled: "yes" })).status).toBe(400);
  });
  it("manages tiers, ordered by spend, with unique names and thresholds", async () => {
    const mk = (over: Record<string, unknown>) => admin.post("/api/admin/loyalty/tiers").send({ name: "Gold", minLifetimeSpendInr: 25000, earnMultiplierPct: 150, perks: "Early access", ...over });
    const gold = await mk({});
    expect(gold.status).toBe(201);
    const silver = await mk({ name: "Silver", minLifetimeSpendInr: 0, earnMultiplierPct: 100, perks: "" });
    expect(silver.status).toBe(201);
    expect((await admin.get("/api/admin/loyalty")).body.tiers.map((t: { name: string }) => t.name)).toEqual(["Silver", "Gold"]);

    const dupName = await mk({ name: "gold", minLifetimeSpendInr: 99999 });
    expect(dupName.status).toBe(409);
    expect(dupName.body.error.message).toMatch(/name/i);
    const dupSpend = await mk({ name: "Bronze", minLifetimeSpendInr: 25000 });
    expect(dupSpend.status).toBe(409);
    expect(dupSpend.body.error.message).toMatch(/spend/i);
    expect((await mk({ name: "Low", minLifetimeSpendInr: 5, earnMultiplierPct: 10 })).status).toBe(400);

    const id = gold.body.tier.id;
    const upd = await admin.put(`/api/admin/loyalty/tiers/${id}`).send({ name: "Gold", minLifetimeSpendInr: 30000, earnMultiplierPct: 175, perks: "Free gift wrap" });
    expect(upd.body.tier).toMatchObject({ minLifetimeSpendInr: 30000, earnMultiplierPct: 175, perks: "Free gift wrap" });
    expect((await admin.del(`/api/admin/loyalty/tiers/${id}`)).status).toBe(204);
    expect((await admin.del(`/api/admin/loyalty/tiers/${id}`)).status).toBe(404);
  });
});

describe("discount combinations", () => {
  it("starts with a conservative matrix covering every pair", async () => {
    const g = await admin.get("/api/admin/discounts");
    expect(g.body).toMatchObject({ stackingMode: "best_only", maxTotalDiscountPct: 70 });
    expect(g.body.kinds).toEqual(["offer", "coupon", "loyalty", "free_shipping"]);
    expect(g.body.combinations).toHaveLength(10);
    const allowed = (a: string, b: string) => g.body.combinations.find((c: { a: string; b: string }) => c.a === a && c.b === b).allowed;
    expect(allowed("coupon", "offer")).toBe(false);
    expect(allowed("loyalty", "offer")).toBe(true);
  });
  it("saves the mode, cap and pairs (in either order) atomically", async () => {
    const put = await admin.put("/api/admin/discounts").send({
      stackingMode: "stack", maxTotalDiscountPct: 40,
      combinations: [{ a: "offer", b: "coupon", allowed: true }, { a: "loyalty", b: "loyalty", allowed: true }],
    });
    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({ stackingMode: "stack", maxTotalDiscountPct: 40 });
    expect(put.body.combinations).toHaveLength(10); // normalised: still one row per unordered pair
    const find = (a: string, b: string) => put.body.combinations.find((c: { a: string; b: string }) => c.a === a && c.b === b);
    expect(find("coupon", "offer").allowed).toBe(true);
    expect(find("loyalty", "loyalty").allowed).toBe(true);
    expect(find("loyalty", "offer").allowed).toBe(true); // untouched
  });
  it("rejects bad input without changing anything", async () => {
    const before = (await admin.get("/api/admin/discounts")).body;
    const base = { stackingMode: "stack", maxTotalDiscountPct: 40 };
    expect((await admin.put("/api/admin/discounts").send({ ...base, maxTotalDiscountPct: 0 })).status).toBe(400);
    expect((await admin.put("/api/admin/discounts").send({ ...base, maxTotalDiscountPct: 101 })).status).toBe(400);
    expect((await admin.put("/api/admin/discounts").send({ ...base, stackingMode: "everything" })).status).toBe(400);
    expect((await admin.put("/api/admin/discounts").send({ ...base, combinations: [{ a: "offer", b: "gift_card", allowed: true }] })).status).toBe(400);
    const dup = await admin.put("/api/admin/discounts").send({ ...base, maxTotalDiscountPct: 10, combinations: [{ a: "offer", b: "coupon", allowed: true }, { a: "coupon", b: "offer", allowed: false }] });
    expect(dup.status).toBe(400);
    expect((await admin.get("/api/admin/discounts")).body).toEqual(before);
  });
});

describe("audit trail", () => {
  it("records admin configuration changes", async () => {
    const { rows } = await query<{ action: string }>("SELECT DISTINCT action FROM audit_log WHERE action LIKE 'admin\\_%' ESCAPE '\\'");
    const actions = rows.map((r) => r.action);
    for (const a of ["admin_branding_update", "admin_logo_update", "admin_logo_remove", "admin_offer_create", "admin_offer_update", "admin_offer_delete", "admin_loyalty_update", "admin_tier_create", "admin_discounts_update"]) {
      expect(actions).toContain(a);
    }
  });
});
