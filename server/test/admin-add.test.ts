import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { closePool, query } from "../src/db/pool.js";
import { migrate } from "../src/db/migrate.js";

const ORIGIN = "https://shop.example.com";
const DEFAULT_PASSWORD = "Admin@2026";
const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tsx = path.join(serverDir, "node_modules/tsx/dist/cli.mjs");
const app = createApp();

/** Runs `npm run admin:add -- …` the way a person would (the test DB comes from the inherited environment). */
function addAdmin(...args: string[]): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile(process.execPath, [tsx, "src/db/add-admin.ts", ...args], { cwd: serverDir, env: { ...process.env } }, (err, stdout, stderr) => {
      resolve({ code: err ? ((err as { code?: number }).code ?? 1) : 0, out: `${stdout}${stderr}` });
    });
  });
}

function client() {
  const agent = request.agent(app);
  const wrap = (m: "get" | "post") => (url: string) => agent[m](url).set("Origin", ORIGIN);
  return { get: wrap("get"), post: wrap("post") };
}
const login = (c: ReturnType<typeof client>, identifier: string, password: string) => c.post("/api/auth/login").send({ identifier, password });

beforeAll(async () => { await migrate(); });
afterAll(async () => { await closePool(); });

describe("adding an admin by hand", () => {
  it("creates an admin with the default password, and locks the console until it is changed", async () => {
    const r = await addAdmin("jane.admin@example.com", "jane_admin", "Jane Doe");
    expect(r.code).toBe(0);
    expect(r.out).toContain("Admin added: jane_admin");

    const c = client();
    const l = await login(c, "jane_admin", DEFAULT_PASSWORD);
    expect(l.status).toBe(200);
    expect(l.body.user).toMatchObject({ role: "admin", username: "jane_admin", name: "Jane Doe", mustChangePassword: true });
    expect((await c.get("/api/auth/me")).body.user.mustChangePassword).toBe(true);

    // Signed in, but the admin console stays shut.
    const locked = await c.get("/api/admin/offers");
    expect(locked.status).toBe(403);
    expect(locked.body.error.code).toBe("password_change_required");
    expect((await c.get("/api/admin/branding")).status).toBe(403);

    // The new password has to be genuinely new.
    const change = (current: string, next: string) => c.post("/api/auth/change-password").send({ currentPassword: current, newPassword: next });
    expect((await change(DEFAULT_PASSWORD, DEFAULT_PASSWORD)).status).toBe(400);
    expect((await change("wrong-current-pass", "a-brand-new-passphrase")).status).toBe(401);
    expect((await change(DEFAULT_PASSWORD, "short")).status).toBe(400);

    const ok = await change(DEFAULT_PASSWORD, "a-brand-new-passphrase");
    expect(ok.status).toBe(200);
    expect(ok.body.user.mustChangePassword).toBe(false);
    expect((await c.get("/api/admin/offers")).status).toBe(200); // unlocked, same session

    // The default no longer works; the new password does.
    expect((await login(client(), "jane_admin", DEFAULT_PASSWORD)).status).toBe(401);
    const again = await login(client(), "jane.admin@example.com", "a-brand-new-passphrase");
    expect(again.status).toBe(200);
    expect(again.body.user.mustChangePassword).toBe(false);
  });

  it("works with just an email, and never overwrites an existing account unless told to", async () => {
    expect((await addAdmin("solo.admin@example.com")).code).toBe(0);
    expect((await login(client(), "solo.admin@example.com", DEFAULT_PASSWORD)).body.user).toMatchObject({ role: "admin", name: "Administrator", username: null });

    const dup = await addAdmin("solo.admin@example.com");
    expect(dup.code).toBe(1);
    expect(dup.out).toMatch(/already exists/);

    // an ordinary shopper keeps their password and role
    const shopper = client();
    await shopper.post("/api/auth/register").send({ name: "Sam", email: "sam.shopper@example.com", password: "sams-own-passphrase-1" });
    expect((await addAdmin("sam.shopper@example.com")).code).toBe(1);
    expect((await login(client(), "sam.shopper@example.com", "sams-own-passphrase-1")).body.user.role).toBe("user");

    // --promote is the explicit way, and resets to the default password
    expect((await addAdmin("sam.shopper@example.com", "sam_admin", "--promote")).code).toBe(0);
    expect((await login(client(), "sam.shopper@example.com", "sams-own-passphrase-1")).status).toBe(401);
    expect((await login(client(), "sam_admin", DEFAULT_PASSWORD)).body.user).toMatchObject({ role: "admin", mustChangePassword: true });
  });

  it("can print a ready-to-run INSERT instead of touching the database", async () => {
    const r = await addAdmin("sql.admin@example.com", "sql_admin", "O'Brien", "--print-sql");
    expect(r.code).toBe(0);
    expect((await query("SELECT 1 FROM users WHERE email = 'sql.admin@example.com'")).rowCount).toBe(0); // nothing written yet
    const sql = r.out.split("\n").filter((l) => !l.startsWith("--") && l.trim()).join("\n");
    expect(sql).toMatch(/^INSERT INTO users/);
    expect(sql).toContain("'O''Brien'"); // quotes are escaped

    await query(sql); // exactly what someone would paste into psql
    const l = await login(client(), "sql_admin", DEFAULT_PASSWORD);
    expect(l.status).toBe(200);
    expect(l.body.user).toMatchObject({ role: "admin", name: "O'Brien", mustChangePassword: true });
  });

  it("rejects bad input", async () => {
    expect((await addAdmin("not-an-email")).code).toBe(1);
    expect((await addAdmin("ok@example.com", "Bad Name!")).code).toBe(1);
    expect((await addAdmin()).code).toBe(1);
    expect((await query("SELECT 1 FROM users WHERE email = 'ok@example.com'")).rowCount).toBe(0);
  });
});

describe("admins cannot be created from the website", () => {
  it("ignores any role, username or flags sent when registering", async () => {
    const c = client();
    const r = await c.post("/api/auth/register").send({
      name: "Mallory", email: "mallory.try@example.com", password: "mallorys-passphrase-1",
      role: "admin", username: "root", mustChangePassword: false, must_change_password: false,
    });
    expect(r.status).toBe(201);
    expect(r.body.user).toMatchObject({ role: "user", username: null, mustChangePassword: false });
    expect((await c.get("/api/admin/offers")).status).toBe(403);
    expect((await c.post("/api/admin/offers").send({ name: "x", kind: "free_shipping" })).status).toBe(403);
  });
  it("does not let anyone register with the default admin password", async () => {
    const r = await client().post("/api/auth/register").send({ name: "X", email: "defpw@example.com", password: DEFAULT_PASSWORD });
    expect(r.status).toBe(400);
  });
});
