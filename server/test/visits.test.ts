import fs from "node:fs";
import path from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { closePool, query, withTx } from "../src/db/pool.js";
import { migrate } from "../src/db/migrate.js";
import { purgeAll } from "../src/lib/caches.js";

const ORIGIN = "https://shop.example.com";
const BROWSER = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const app = createApp();

const load = (headers: Record<string, string> = {}) => request(app).post("/api/visits").set("Origin", ORIGIN).set("User-Agent", BROWSER).set(headers);
const counter = async () => Number((await query<{ value: string }>("SELECT value FROM site_counters WHERE name = 'page_loads'")).rows[0]!.value);

beforeAll(async () => { await migrate(); });
afterAll(async () => { await closePool(); });

describe("visitor counter: every page load counts", () => {
  it("goes up by one on every load or refresh, even from the same browser", async () => {
    const before = await counter();
    for (let i = 1; i <= 5; i++) {
      const r = await load();
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ total: before + i, counted: true });
    }
    expect(await counter()).toBe(before + 5);
  });

  it("serves the total publicly, with a short cache, and it matches the counter", async () => {
    purgeAll();
    const r = await request(app).get("/api/visits");
    expect(r.status).toBe(200);
    expect(r.headers["cache-control"]).toContain("max-age=15");
    expect(r.body.total).toBe(await counter());
  });

  it("a load is never cached: the POST answer is the new total, and a read right after sees it", async () => {
    const r = await load();
    expect(r.headers["cache-control"]).toBe("no-store");
    purgeAll();
    expect((await request(app).get("/api/visits")).body.total).toBe(r.body.total);
  });

  it("adds exactly one for each of many loads at the same moment", async () => {
    const before = await counter();
    const all = await Promise.all(Array.from({ length: 25 }, () => load()));
    expect(all.every((r) => r.status === 200 && r.body.counted)).toBe(true);
    expect(new Set(all.map((r) => r.body.total)).size).toBe(25); // 25 different answers: nothing lost, nothing counted twice
    expect(await counter()).toBe(before + 25);
  });

  it("needs no information about the visitor, and keeps none: only a number", async () => {
    const before = await counter();
    expect((await load().send({ visitorId: "ignored" })).status).toBe(200); // an old browser still sending its id is harmless
    expect(await counter()).toBe(before + 1);
    const cols = (await query<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_name = 'site_counters'")).rows.map((r) => r.column_name);
    expect(cols.sort()).toEqual(["name", "updated_at", "value"]); // no ip, user agent or id
  });

  it("does not count crawlers, monitors or scripts", async () => {
    const before = await counter();
    for (const ua of ["Googlebot/2.1 (+http://www.google.com/bot.html)", "bingbot/2.0", "curl/8.4.0", "python-requests/2.31", "HeadlessChrome/120", "UptimeRobot/2.0"]) {
      const r = await request(app).post("/api/visits").set("Origin", ORIGIN).set("User-Agent", ua);
      expect(r.body).toEqual({ total: before, counted: false });
    }
    expect((await request(app).post("/api/visits").set("Origin", ORIGIN).unset("User-Agent")).body.counted).toBe(false); // no user agent at all
    expect(await counter()).toBe(before);
  });

  it("counts a visitor who sends Do Not Track, because nothing about them is stored", async () => {
    const before = await counter();
    expect((await load({ DNT: "1" })).body.counted).toBe(true);
    expect((await load({ "Sec-GPC": "1" })).body.counted).toBe(true);
    expect(await counter()).toBe(before + 2);
  });

  it("refuses a foreign origin without counting", async () => {
    const before = await counter();
    const evil = await request(app).post("/api/visits").set("Origin", "https://evil.example").set("User-Agent", BROWSER);
    expect(evil.status).toBe(403);
    expect(await counter()).toBe(before);
  });
});

describe("migration 008", () => {
  it("starts the counter from the number of unique visitors the footer showed", async () => {
    const sql = fs.readFileSync(path.resolve(__dirname, "../src/db/migrations/008_site_counters.sql"), "utf8");
    // Run it again on a copy of the situation (13 visitors recorded, no counter yet), then undo everything.
    const seen = await withTx(async (db) => {
      await db.query("DROP TABLE site_counters");
      await db.query("DELETE FROM site_visitors");
      for (let i = 0; i < 13; i++) await db.query("INSERT INTO site_visitors (visitor_hash) VALUES ($1)", [String(i).padStart(64, "0")]);
      await db.query(sql);
      const value = Number((await db.query<{ value: string }>("SELECT value FROM site_counters WHERE name = 'page_loads'")).rows[0]!.value);
      throw Object.assign(new Error("rollback"), { value });
    }).catch((e: Error & { value?: number }) => e.value);
    expect(seen).toBe(13);
    expect(await counter()).toBeGreaterThan(0); // the real counter is untouched
  });
});
