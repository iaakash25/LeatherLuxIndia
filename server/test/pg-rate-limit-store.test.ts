import express from "express";
import { rateLimit } from "express-rate-limit";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePool, query } from "../src/db/pool.js";
import { migrate } from "../src/db/migrate.js";
import { PgRateLimitStore } from "../src/middleware/pg-rate-limit-store.js";

const NAME = "zz-test";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const store = (windowMs = 60_000, name = NAME) => { const s = new PgRateLimitStore(name); s.init({ windowMs } as never); return s; };

beforeAll(async () => { await migrate(); });
afterAll(async () => { await query("DELETE FROM rate_limits WHERE key LIKE 'zz-test%'"); await closePool(); });

describe("PgRateLimitStore", () => {
  it("counts hits within a window", async () => {
    const s = store();
    expect((await s.increment("1.1.1.1")).totalHits).toBe(1);
    expect((await s.increment("1.1.1.1")).totalHits).toBe(2);
    const third = await s.increment("1.1.1.1");
    expect(third.totalHits).toBe(3);
    expect(third.resetTime!.getTime()).toBeGreaterThan(Date.now());
  });

  it("is shared between store instances, as separate server instances would share it", async () => {
    const a = store(), b = store();
    await a.increment("2.2.2.2");
    await b.increment("2.2.2.2");
    expect((await a.increment("2.2.2.2")).totalHits).toBe(3);
  });

  it("starts a fresh window once the first one has ended", async () => {
    const s = store(300);
    await s.increment("3.3.3.3"); await s.increment("3.3.3.3");
    await sleep(450);
    expect((await s.increment("3.3.3.3")).totalHits).toBe(1);
  });

  it("keeps limiters and addresses apart", async () => {
    await store(60_000, "zz-test-a").increment("4.4.4.4");
    expect((await store(60_000, "zz-test-b").increment("4.4.4.4")).totalHits).toBe(1);
    expect((await store(60_000, "zz-test-a").increment("5.5.5.5")).totalHits).toBe(1);
  });

  it("can take a hit back and reset an address", async () => {
    const s = store();
    await s.increment("6.6.6.6"); await s.increment("6.6.6.6");
    await s.decrement("6.6.6.6");
    expect((await s.increment("6.6.6.6")).totalHits).toBe(2);
    await s.resetKey("6.6.6.6");
    expect((await s.increment("6.6.6.6")).totalHits).toBe(1);
  });

  it("enforces ONE limit across two separate app instances (what serverless needs)", async () => {
    // Two apps, each with its own limiter object and nothing in common but the database: like two Vercel function instances.
    const makeApp = () => {
      const app = express();
      app.use(rateLimit({ windowMs: 60_000, limit: 3, store: store(60_000, "zz-test-shared"), keyGenerator: () => "7.7.7.7", validate: false, handler: (_q, res) => { res.status(429).json({ error: "limited" }); } }));
      app.get("/", (_q, res) => { res.json({ ok: true }); });
      return app;
    };
    const one = makeApp(), two = makeApp();
    const statuses = [(await request(one).get("/")).status, (await request(two).get("/")).status, (await request(one).get("/")).status, (await request(two).get("/")).status, (await request(one).get("/")).status];
    expect(statuses).toEqual([200, 200, 200, 429, 429]); // the fourth request is refused whichever instance it reaches
  });
});
