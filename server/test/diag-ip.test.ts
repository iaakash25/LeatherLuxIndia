import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";

// TEMPORARY, with src/routes/diag-ip.ts.
describe("temporary address diagnostic", () => {
  it("shows only the caller's own request details", async () => {
    const r = await request(createApp()).get("/api/diag-ip").set("X-Forwarded-For", "203.0.113.9");
    expect(r.status).toBe(200);
    expect(Object.keys(r.body).sort()).toEqual(["headers", "ip", "ips", "platform", "socketAddress", "trustProxy"]);
    expect(r.body.headers["x-forwarded-for"]).toBe("203.0.113.9");
    expect(JSON.stringify(r.body)).not.toMatch(/password|secret|pepper|token/i);
  });
});
