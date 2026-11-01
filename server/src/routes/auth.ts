import { Router } from "express";
import { z } from "zod";
import { query, withTx } from "../db/pool.js";
import { badRequest, conflict, unauthorized } from "../lib/errors.js";
import type { Role } from "../lib/roles.js";
import { fakeVerify, hashPassword, verifyPassword } from "../lib/passwords.js";
import { audit, clearSession, issueSession } from "../lib/session.js";
import { invalidateUser } from "../lib/caches.js";
import { hashToken } from "../lib/tokens.js";
import { me, REFRESH_COOKIE, requireAuth } from "../middleware/auth.js";
import { authLimiter } from "../middleware/rate-limit.js";

const MAX_FAILED_LOGINS = 10;
const LOCK_MINUTES = 15;
const REFRESH_RACE_GRACE_MS = 10_000;

const COMMON = new Set([
  "password123", "1234567890", "qwertyuiop", "iloveyou123", "welcome123", "admin12345",
  "password1234", "letmein1234", "1q2w3e4r5t", "abc1234567", "passw0rd123", "changeme123",
  "admin@2026", // the default given to new admins
]);

const email = z.string().trim().toLowerCase().pipe(z.email().max(254));
const newPassword = z.string().min(10, "Use at least 10 characters").max(128, "Use at most 128 characters")
  .refine((p) => !COMMON.has(p.toLowerCase()), "That password is too common");

const registerSchema = z.object({
  name: z.string().trim().min(1).max(80),
  email,
  password: newPassword,
}).refine((v) => v.password.toLowerCase() !== v.email, { path: ["password"], message: "Password must not be your email" });

// Sign in with an email address or a username. `email` is still accepted as an alias for `identifier`.
const identifier = z.string().trim().toLowerCase().min(1, "Enter your email or username").max(254);
const loginSchema = z.object({ identifier: identifier.optional(), email: identifier.optional(), password: z.string().min(1).max(128) })
  .refine((v) => v.identifier || v.email, { path: ["identifier"], message: "Enter your email or username" });
const changePasswordSchema = z.object({ currentPassword: z.string().min(1).max(128), newPassword });

type UserRow = {
  id: string; email: string; username: string | null; name: string; password_hash: string; role: Role;
  token_version: number; failed_logins: number; locked_until: Date | null; must_change_password: boolean;
};
const publicUser = (u: Pick<UserRow, "id" | "email" | "username" | "name" | "role" | "must_change_password">) =>
  ({ id: u.id, email: u.email, username: u.username, name: u.name, role: u.role, mustChangePassword: u.must_change_password });

export const authRouter = Router();
authRouter.use(authLimiter());

authRouter.post("/register", async (req, res) => {
  const body = registerSchema.parse(req.body);
  const hash = await hashPassword(body.password);
  let row: UserRow;
  try {
    const r = await query<UserRow>(
      "INSERT INTO users (email, name, password_hash) VALUES ($1,$2,$3) RETURNING *",
      [body.email, body.name, hash],
    );
    row = r.rows[0]!;
  } catch (err) {
    if ((err as { code?: string }).code === "23505") throw conflict("An account with this email already exists", "email_taken");
    throw err;
  }
  await issueSession(req, res, row);
  await audit(req, "register", row.id);
  res.status(201).json({ user: publicUser(row) });
});

authRouter.post("/login", async (req, res) => {
  const body = loginSchema.parse(req.body);
  const who = (body.identifier ?? body.email)!;
  const password = body.password;
  // Usernames can't contain "@", so an identifier matches at most one account.
  const { rows } = await query<UserRow>("SELECT * FROM users WHERE email = $1 OR username = $1", [who]);
  const user = rows[0];
  const locked = !!user?.locked_until && user.locked_until > new Date();

  // Same status, message and (roughly) timing for: unknown email, wrong password, locked account.
  const ok = user && !locked ? await verifyPassword(password, user.password_hash) : await fakeVerify(password);
  if (!user || !ok) {
    if (user && !locked) {
      await query(
        `UPDATE users SET failed_logins = failed_logins + 1,
           locked_until = CASE WHEN failed_logins + 1 >= $2 THEN now() + ($3 || ' minutes')::interval ELSE locked_until END
         WHERE id = $1`,
        [user.id, MAX_FAILED_LOGINS, String(LOCK_MINUTES)],
      );
    }
    await audit(req, "login_failed", user?.id ?? null, { locked });
    throw unauthorized("Invalid email or password");
  }

  await query("UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = now() WHERE id = $1", [user.id]);
  await issueSession(req, res, user);
  await audit(req, "login", user.id);
  res.json({ user: publicUser(user) });
});

authRouter.post("/refresh", async (req, res) => {
  const raw: unknown = req.cookies?.[REFRESH_COOKIE];
  if (typeof raw !== "string" || raw.length < 20 || raw.length > 200) { clearSession(res); throw unauthorized(); }

  type Outcome = { kind: "ok"; user: UserRow } | { kind: "race" } | { kind: "reuse"; userId: string } | { kind: "invalid" };
  const outcome = await withTx<Outcome>(async (db) => {
    const t = (await db.query<{ id: string; user_id: string; family_id: string; expires_at: Date; revoked_at: Date | null; replaced_by: string | null }>(
      "SELECT id, user_id, family_id, expires_at, revoked_at, replaced_by FROM refresh_tokens WHERE token_hash = $1 FOR UPDATE",
      [hashToken(raw)],
    )).rows[0];
    if (!t) return { kind: "invalid" };

    if (t.revoked_at) {
      // Two tabs refreshing at once legitimately replay the just-rotated token: don't punish that.
      if (t.replaced_by && Date.now() - t.revoked_at.getTime() < REFRESH_RACE_GRACE_MS) return { kind: "race" };
      // Otherwise a rotated-out token came back: assume theft and kill the whole family.
      await db.query("UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL", [t.family_id]);
      return { kind: "reuse", userId: t.user_id };
    }
    if (t.expires_at <= new Date()) return { kind: "invalid" };

    const user = (await db.query<UserRow>("SELECT * FROM users WHERE id = $1", [t.user_id])).rows[0];
    if (!user) return { kind: "invalid" };

    const newId = await issueSession(req, res, user, { familyId: t.family_id, db });
    await db.query("UPDATE refresh_tokens SET revoked_at = now(), replaced_by = $2 WHERE id = $1", [t.id, newId]);
    return { kind: "ok", user };
  });

  if (outcome.kind === "ok") { res.json({ user: publicUser(outcome.user) }); return; }
  if (outcome.kind === "reuse") await audit(req, "refresh_token_reuse", outcome.userId);
  // On a benign race another request already set fresh cookies; clearing here would erase them.
  if (outcome.kind !== "race") clearSession(res);
  throw unauthorized("Session expired");
});

authRouter.post("/logout", async (req, res) => {
  const raw: unknown = req.cookies?.[REFRESH_COOKIE];
  if (typeof raw === "string" && raw.length <= 200) {
    await query(
      `UPDATE refresh_tokens SET revoked_at = now()
       WHERE revoked_at IS NULL AND family_id = (SELECT family_id FROM refresh_tokens WHERE token_hash = $1)`,
      [hashToken(raw)],
    );
  }
  clearSession(res);
  res.status(204).end();
});

authRouter.get("/me", requireAuth, (req, res) => {
  const u = me(req);
  res.json({ user: { id: u.id, email: u.email, username: u.username, name: u.name, role: u.role, mustChangePassword: u.mustChangePassword } });
});

/** Sign out on every device: invalidates all access tokens (token_version) and refresh tokens. */
authRouter.post("/logout-all", requireAuth, async (req, res) => {
  const u = me(req);
  await withTx(async (db) => {
    await db.query("UPDATE users SET token_version = token_version + 1, updated_at = now() WHERE id = $1", [u.id]);
    await db.query("UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [u.id]);
  });
  invalidateUser(u.id); // other devices must be turned away on their very next request
  await audit(req, "logout_all", u.id);
  clearSession(res);
  res.status(204).end();
});

authRouter.post("/change-password", requireAuth, async (req, res) => {
  const u = me(req);
  const body = changePasswordSchema.parse(req.body);
  if (body.newPassword === body.currentPassword) throw badRequest("Choose a new password, different from the current one.");
  const row = (await query<UserRow>("SELECT * FROM users WHERE id = $1", [u.id])).rows[0];
  if (!row || !(await verifyPassword(body.currentPassword, row.password_hash))) {
    await audit(req, "change_password_failed", u.id);
    throw unauthorized("Current password is incorrect");
  }
  const hash = await hashPassword(body.newPassword);
  const updated = await withTx(async (db) => {
    const r = await db.query<UserRow>(
      "UPDATE users SET password_hash = $2, token_version = token_version + 1, must_change_password = false, updated_at = now() WHERE id = $1 RETURNING *",
      [u.id, hash],
    );
    await db.query("UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [u.id]);
    return r.rows[0]!;
  });
  invalidateUser(u.id);
  await issueSession(req, res, updated); // keep this device signed in, drop all others
  await audit(req, "change_password", u.id);
  res.json({ user: publicUser(updated) });
});
