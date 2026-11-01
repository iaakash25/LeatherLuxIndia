import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseEnv } from "../src/config/env.js";

// server/deploy/env.production.example is what gets copied to the server. It must stay a valid production configuration:
// a template that the app refuses to start with is found out on deploy day, not in a test.
const TEMPLATE = path.resolve(__dirname, "../deploy/env.production.example");
const lines = fs.readFileSync(TEMPLATE, "utf8").split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith("#"));

const filled = (): Record<string, string> => {
  const env: Record<string, string> = {};
  for (const l of lines) {
    const i = l.indexOf("=");
    env[l.slice(0, i)] = l.slice(i + 1);
  }
  env["DB_PASSWORD"] = "a-genuine-looking-db-password-1";
  env["JWT_ACCESS_SECRET"] = "j".repeat(48);
  env["PASSWORD_PEPPER"] = "p".repeat(48);
  return env;
};

describe("deploy/env.production.example", () => {
  it("has no inline comments (dotenv and systemd read those differently)", () => {
    for (const l of lines) expect(l, l).toMatch(/^[A-Z][A-Z0-9_]*=[^#\s]*$/);
  });

  it("is a valid production configuration once the secrets are filled in", () => {
    const e = parseEnv(filled() as unknown as NodeJS.ProcessEnv);
    expect(e.isProd).toBe(true);
    expect(e.cookieSecure).toBe(true);
    expect(e.HOST).toBe("127.0.0.1"); // only nginx may reach it
    expect(e.TRUST_PROXY).toBe(1);
    // Both domains, each with its www host, so the shop can be served on either without redirecting one to the other.
    expect(e.corsOrigins).toEqual([
      "https://leatherluxindia.com", "https://www.leatherluxindia.com", "https://leatherluxindia.in", "https://www.leatherluxindia.in",
    ]);
    expect(e.COOKIE_DOMAIN).toBe(".leatherluxindia.com");
    expect(e.DB_SSL_MODE).not.toBe("disable");
  });

  it("refuses to start while a secret is still a placeholder", () => {
    for (const key of ["JWT_ACCESS_SECRET", "PASSWORD_PEPPER", "DB_PASSWORD"]) {
      const env = filled();
      env[key] = "REPLACE_ME";
      expect(() => parseEnv(env as unknown as NodeJS.ProcessEnv), key).toThrow();
    }
  });
});
