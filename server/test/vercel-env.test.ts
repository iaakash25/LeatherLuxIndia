import fs from "node:fs";
import path from "node:path";
import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { parseEnv } from "../src/config/env.js";

// server/deploy/vercel.env.example is what gets typed into Vercel's Environment Variables. It must stay a valid production configuration:
// a template the API refuses to start with would only be found out on deploy day.
const TEMPLATE = path.resolve(__dirname, "../deploy/vercel.env.example");
const lines = fs.readFileSync(TEMPLATE, "utf8").split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith("#"));
const PEM = "-----BEGIN CERTIFICATE-----\\nMIIBplaceholder\\n-----END CERTIFICATE-----";

const filled = (): Record<string, string> => {
  const env: Record<string, string> = {};
  for (const l of lines) { const i = l.indexOf("="); env[l.slice(0, i)] = l.slice(i + 1); }
  Object.assign(env, { DB_HOST: "db.example.com", DB_PASSWORD: "a-genuine-looking-db-password-1", DB_SSL_SERVERNAME: "db.example.com", DB_SSL_CA: PEM,
    JWT_ACCESS_SECRET: "j".repeat(48), PASSWORD_PEPPER: "p".repeat(48) });
  return env;
};
const parse = (env: Record<string, string>) => parseEnv(env as unknown as NodeJS.ProcessEnv);

describe("deploy/vercel.env.example", () => {
  it("has no inline comments", () => {
    for (const l of lines) expect(l, l).toMatch(/^[A-Z][A-Z0-9_]*=[^#\s]*$/);
  });

  it("is a valid production configuration once the placeholders are filled in", () => {
    const e = parse(filled());
    expect(e.isProd).toBe(true);
    expect(e.cookieSecure).toBe(true);
    expect(e.logToFiles).toBe(false); // read-only disk
    expect(e.TRUST_PROXY).toBe(1);
    expect(e.COOKIE_DOMAIN).toBeUndefined(); // same origin: host-only cookies
    expect(e.COOKIE_SAMESITE).toBe("lax");
    expect(e.corsOrigins).toEqual([
      "https://leatherluxindia.com", "https://www.leatherluxindia.com", "https://leatherluxindia.in", "https://www.leatherluxindia.in", "https://leatherluxindia.vercel.app",
    ]);
  });

  it("is safe for serverless: shared rate limits, a small pool, and a verified database connection", () => {
    const e = parse(filled());
    expect(e.RATE_LIMIT_STORE).toBe("postgres");
    expect(e.DB_POOL_MAX).toBeLessThanOrEqual(5);
    expect(e.DB_SSL_MODE).toBe("verify-full");
    expect(e.ORDERS_OPEN).toBe(false); // closed until launch
  });

  it("on Vercel, believes Vercel's forwarding header even when TRUST_PROXY was never typed in, so each visitor has their own address", async () => {
    const env = filled(); delete env["TRUST_PROXY"];
    expect(parse(env).TRUST_PROXY).toBe(0); // not on Vercel: a forged header is not believed
    for (const marker of [{ VERCEL: "1" }, { VERCEL_ENV: "production" }] as Record<string, string>[]) {
      const e = parse({ ...env, ...marker });
      expect(e.TRUST_PROXY, JSON.stringify(marker)).toBe(1);
      const app = express();
      app.set("trust proxy", e.TRUST_PROXY);
      app.get("/ip", (req, res) => { res.json({ ip: req.ip }); });
      const r = await request(app).get("/ip").set("X-Forwarded-For", "203.0.113.5");
      expect(r.body.ip).toBe("203.0.113.5");
    }
    const blank = parse({ ...env, VERCEL: "1", TRUST_PROXY: "" }); // `TRUST_PROXY=` counts as not set
    expect(blank.TRUST_PROXY).toBe(1);
  });

  it("an explicit TRUST_PROXY always wins, on Vercel too", () => {
    const env = filled(); env["VERCEL"] = "1";
    env["TRUST_PROXY"] = "0"; expect(parse(env).TRUST_PROXY).toBe(0);
    env["TRUST_PROXY"] = "2"; expect(parse(env).TRUST_PROXY).toBe(2);
  });

  it("refuses to start while a secret is still a placeholder, or the certificate is not one", () => {
    for (const key of ["JWT_ACCESS_SECRET", "PASSWORD_PEPPER", "DB_PASSWORD"]) {
      const env = filled(); env[key] = "REPLACE_ME";
      expect(() => parse(env), key).toThrow();
    }
    const env = filled(); env["DB_SSL_CA"] = "REPLACE_ME";
    expect(() => parse(env)).toThrow(/PEM/);
  });
});
