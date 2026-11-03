import crypto from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { closePool, query } from "../src/db/pool.js";
import { migrate } from "../src/db/migrate.js";
import { cleanPath, cleanReferrer, clientIp, pruneVisitLog, recordPageView } from "../src/lib/visit-log.js";

const ORIGIN = "https://shop.example.com";
const BROWSER = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const app = createApp();

const log = (body: unknown, headers: Record<string, string> = {}) =>
  request(app).post("/api/visits/log").set("Origin", ORIGIN).set("User-Agent", BROWSER).set(headers).send(body as object);
const marker = () => `/zz-test-${crypto.randomUUID().slice(0, 8)}`;
type Row = { ip: string; path: string; referrer: string | null; user_agent: string | null; is_bot: boolean; visited_at: Date };
const rowsFor = async (path: string) => (await query<Row>("SELECT host(ip) AS ip, path, referrer, user_agent, is_bot, visited_at FROM visit_log WHERE path = $1 ORDER BY id", [path])).rows;

beforeAll(async () => { await migrate(); });
afterAll(async () => { await query("DELETE FROM visit_log WHERE path LIKE '/zz-test-%'"); await closePool(); });

describe("the visit log records every page view", () => {
  it("writes the visitor's address, the page, the browser and the time", async () => {
    const path = marker();
    const before = Date.now();
    const r = await log({ path });
    expect(r.status).toBe(204);
    const [row] = await rowsFor(path);
    expect(row).toMatchObject({ ip: "127.0.0.1", path, referrer: null, user_agent: BROWSER, is_bot: false });
    expect(Math.abs(row!.visited_at.getTime() - before)).toBeLessThan(10_000);
  });

  it("writes a row for every view, including the same page twice and a page after a page", async () => {
    const a = marker(), b = marker();
    await log({ path: a }); await log({ path: a }); await log({ path: b });
    expect((await rowsFor(a)).length).toBe(2);
    expect((await rowsFor(b)).length).toBe(1);
  });

  it("keeps only the page, never the query string or what follows #", async () => {
    const path = marker();
    expect((await log({ path: `${path}?q=secret+words&email=a@b.com#top` })).status).toBe(204);
    expect((await rowsFor(path)).length).toBe(1);
    expect((await query("SELECT 1 FROM visit_log WHERE path LIKE '%secret%' OR path LIKE '%@%'")).rowCount).toBe(0);
  });

  it("keeps only the address of the site a visitor came from, not its page or search words", async () => {
    const [a, b, c] = [marker(), marker(), marker()];
    await log({ path: a, referrer: "https://www.google.com/search?q=leather+lux+india&sca=1" });
    await log({ path: b, referrer: "javascript:alert(1)" });
    await log({ path: c, referrer: "not a url at all" });
    expect((await rowsFor(a))[0]!.referrer).toBe("https://www.google.com");
    expect((await rowsFor(b))[0]!.referrer).toBeNull();
    expect((await rowsFor(c))[0]!.referrer).toBeNull();
  });

  it("logs crawlers and visitors without a browser too, marked, so they can be filtered out", async () => {
    const path = marker();
    await log({ path }, { "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" });
    await request(app).post("/api/visits/log").set("Origin", ORIGIN).unset("User-Agent").send({ path });
    const rows = await rowsFor(path);
    expect(rows.map((r) => r.is_bot)).toEqual([true, true]);
    expect(rows[1]!.user_agent).toBeNull();
  });

  it("uses the address the connection really came from: a forged X-Forwarded-For is not believed (TRUST_PROXY=0)", async () => {
    const path = marker();
    await log({ path }, { "X-Forwarded-For": "203.0.113.99" });
    expect((await rowsFor(path))[0]!.ip).toBe("127.0.0.1");
  });

  it("refuses anything that is not a page path, and a foreign origin, and writes nothing", async () => {
    const before = Number((await query<{ n: string }>("SELECT count(*) AS n FROM visit_log")).rows[0]!.n);
    for (const bad of [{}, { path: "" }, { path: "products" }, { path: "//evil.example/x" }, { path: "/has space" }, { path: "/new\nline" }, { path: "/" + "x".repeat(450) }, { path: 42 }, { path: null }]) {
      expect((await log(bad)).status, JSON.stringify(bad).slice(0, 40)).toBe(400);
    }
    expect((await request(app).post("/api/visits/log").set("Origin", "https://evil.example").set("User-Agent", BROWSER).send({ path: "/x" })).status).toBe(403);
    expect(Number((await query<{ n: string }>("SELECT count(*) AS n FROM visit_log")).rows[0]!.n)).toBe(before);
  });

  it("stores the address as a real IP address type, with indexes for time, address and page", async () => {
    const col = (await query<{ data_type: string }>("SELECT data_type FROM information_schema.columns WHERE table_name = 'visit_log' AND column_name = 'ip'")).rows[0];
    expect(col?.data_type).toBe("inet");
    const idx = (await query<{ indexname: string }>("SELECT indexname FROM pg_indexes WHERE tablename = 'visit_log'")).rows.map((r) => r.indexname);
    expect(idx).toEqual(expect.arrayContaining(["visit_log_time_idx", "visit_log_ip_idx", "visit_log_path_idx"]));
    const cols = (await query<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_name = 'visit_log'")).rows.map((r) => r.column_name);
    expect(cols.sort()).toEqual(["id", "ip", "is_bot", "path", "referrer", "user_agent", "visited_at"]);
  });
});

describe("the log's small helpers", () => {
  it("reads IPv4 written as IPv6, keeps real IPv6, and refuses what is not an address", () => {
    expect(clientIp({ ip: "::ffff:203.0.113.7" })).toBe("203.0.113.7");
    expect(clientIp({ ip: "203.0.113.7" })).toBe("203.0.113.7");
    expect(clientIp({ ip: "2001:db8::1" })).toBe("2001:db8::1");
    for (const bad of [undefined, "", "unknown", "999.1.1.1", "not-an-ip", "1.2.3.4, 5.6.7.8"]) expect(clientIp({ ip: bad as string })).toBeNull();
  });
  it("cleans paths and referrers", () => {
    expect(cleanPath("/a/b?x=1#y")).toBe("/a/b");
    expect(cleanPath("/")).toBe("/");
    for (const bad of ["", "a", "//x", "/a b", "/a\tb", "/" + "x".repeat(301)]) expect(cleanPath(bad), bad).toBeNull();
    expect(cleanReferrer("https://www.bing.com/search?q=x")).toBe("https://www.bing.com");
    expect(cleanReferrer("http://localhost:3000/a")).toBe("http://localhost:3000");
    for (const bad of [undefined, "", "ftp://x.example", "javascript:1", "x"]) expect(cleanReferrer(bad as string)).toBeNull();
  });
});

describe("retention", () => {
  it("deletes entries older than the retention period (365 days) and keeps newer ones", async () => {
    const [old, recent] = [marker(), marker()];
    const now = new Date();
    await recordPageView({ ip: "198.51.100.1", path: old, referrer: null, userAgent: BROWSER, at: new Date(now.getTime() - 400 * 86_400_000) });
    await recordPageView({ ip: "198.51.100.2", path: recent, referrer: null, userAgent: BROWSER, at: new Date(now.getTime() - 100 * 86_400_000) });
    expect(await pruneVisitLog(now)).toBeGreaterThanOrEqual(1);
    expect((await rowsFor(old)).length).toBe(0);
    expect((await rowsFor(recent)).length).toBe(1);
  });
});
