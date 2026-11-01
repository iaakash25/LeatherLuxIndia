import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// A deliberately small login budget, set before the app is loaded (the limiter reads it when the routes are built).
process.env["RATE_LIMIT_AUTH_PER_15MIN"] = "3";
process.env["RATE_LIMIT_STORE"] = "memory";
const ORIGIN = "https://shop.example.com";

let app: import("express").Express;
let closePool: () => Promise<void>;
beforeAll(async () => {
  const { migrate } = await import("../src/db/migrate.js");
  const { seed } = await import("../src/db/seed.js");
  ({ closePool } = await import("../src/db/pool.js"));
  await migrate();
  await seed();
  app = (await import("../src/app.js")).createApp();
});
afterAll(async () => { await closePool(); });

describe("the login limiter", () => {
  it("counts guesses (login, register, password change) on one shared budget, and not the checks every page view makes", async () => {
    const agent = request.agent(app);
    const post = (url: string) => agent.post(url).set("Origin", ORIGIN);

    // What every visitor's browser does on every page: ask who is signed in, and try to renew a session. Far more than the budget of 3.
    for (let i = 0; i < 12; i++) {
      expect((await agent.get("/api/auth/me").set("Origin", ORIGIN)).status).toBe(401);
      expect((await post("/api/auth/refresh")).status).toBe(401);
    }

    // None of that used up the budget: three guesses, mixed between login and registration, are answered normally...
    const login = () => post("/api/auth/login").send({ identifier: "nobody@example.com", password: "not-the-password" });
    const register = () => post("/api/auth/register").send({ name: "x", email: "not-an-email", password: "short" }); // refused as invalid, but still a counted attempt
    expect((await login()).status).toBe(401);
    expect((await register()).status).toBe(400);
    expect((await login()).status).toBe(401);

    // ...and then the shared budget is gone, on every guessable route.
    for (const attempt of [login, register]) {
      const refused = await attempt();
      expect(refused.status).toBe(429);
      expect(refused.body.error.code).toBe("rate_limited");
    }

    // Browsing is still fine for the same visitor.
    expect((await agent.get("/api/auth/me").set("Origin", ORIGIN)).status).toBe(401);
    expect((await agent.get("/api/products?limit=1")).status).toBe(200);
  });
});
