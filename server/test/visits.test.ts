import crypto from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { closePool, query } from "../src/db/pool.js";
import { migrate } from "../src/db/migrate.js";

const ORIGIN = "https://shop.example.com";
const BROWSER = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const app = createApp();

const visit = (id: string, headers: Record<string, string> = {}) =>
  request(app).post("/api/visits").set("Origin", ORIGIN).set("User-Agent", BROWSER).set(headers).send({ visitorId: id });
const rows = async () => Number((await query<{ n: string }>("SELECT count(*) AS n FROM site_visitors")).rows[0]!.n);

beforeAll(async () => { await migrate(); });
afterAll(async () => { await closePool(); });

describe("visitor counter", () => {
  it("counts each browser once, however often it comes back", async () => {
    const before = await rows();
    const id = crypto.randomUUID();

    const first = await visit(id);
    expect(first.status).toBe(200);
    expect(first.body.counted).toBe(true);
    expect(first.body.total).toBe(before + 1);

    const again = await visit(id);
    expect(again.body.total).toBe(before + 1); // same browser: not a new visitor
    expect((await query<{ visits: number }>("SELECT visits FROM site_visitors WHERE first_seen >= now() - interval '1 minute' ORDER BY visits DESC LIMIT 1")).rows[0]!.visits).toBe(2);

    const other = await visit(crypto.randomUUID());
    expect(other.body.total).toBe(before + 2);
  });

  it("serves the total publicly, with a short cache", async () => {
    const r = await request(app).get("/api/visits");
    expect(r.status).toBe(200);
    expect(typeof r.body.total).toBe("number");
    expect(r.headers["cache-control"]).toContain("max-age=15");
    expect(r.body.total).toBe(await rows());
  });

  it("stores only a one-way hash, never the id the browser sent", async () => {
    const id = crypto.randomUUID();
    await visit(id);
    const all = (await query<{ visitor_hash: string }>("SELECT visitor_hash FROM site_visitors")).rows.map((r) => r.visitor_hash);
    expect(all).not.toContain(id);
    expect(all.every((h) => /^[0-9a-f]{64}$/.test(h))).toBe(true);
    const cols = (await query<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_name = 'site_visitors'")).rows.map((r) => r.column_name);
    expect(cols.sort()).toEqual(["first_seen", "last_seen", "visitor_hash", "visits"]); // no ip / user-agent columns
  });

  it("does not count crawlers, monitors or scripts", async () => {
    const before = await rows();
    for (const ua of ["Googlebot/2.1 (+http://www.google.com/bot.html)", "curl/8.4.0", "python-requests/2.31", "HeadlessChrome/120", "UptimeRobot/2.0"]) {
      const r = await request(app).post("/api/visits").set("Origin", ORIGIN).set("User-Agent", ua).send({ visitorId: crypto.randomUUID() });
      expect(r.body.counted).toBe(false);
    }
    expect(await rows()).toBe(before);
  });

  it("respects Do Not Track and Global Privacy Control", async () => {
    const before = await rows();
    expect((await visit(crypto.randomUUID(), { DNT: "1" })).body.counted).toBe(false);
    expect((await visit(crypto.randomUUID(), { "Sec-GPC": "1" })).body.counted).toBe(false);
    expect(await rows()).toBe(before);
    expect((await visit(crypto.randomUUID(), { DNT: "0" })).body.counted).toBe(true);
  });

  it("rejects malformed ids and foreign origins", async () => {
    const before = await rows();
    for (const bad of ["", "not-a-uuid", "1", "x".repeat(500), null, 42]) {
      expect((await request(app).post("/api/visits").set("Origin", ORIGIN).set("User-Agent", BROWSER).send({ visitorId: bad })).status).toBe(400);
    }
    expect((await request(app).post("/api/visits").set("Origin", ORIGIN).set("User-Agent", BROWSER).send({})).status).toBe(400);
    const evil = await request(app).post("/api/visits").set("Origin", "https://evil.example").set("User-Agent", BROWSER).send({ visitorId: crypto.randomUUID() });
    expect(evil.status).toBe(403);
    expect(await rows()).toBe(before);
  });

  it("treats upper- and lower-case forms of one id as the same browser", async () => {
    const id = crypto.randomUUID();
    const before = await rows();
    await visit(id);
    await visit(id.toUpperCase());
    expect(await rows()).toBe(before + 1);
  });
});
