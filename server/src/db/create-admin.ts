import { z } from "zod";
import { closePool, query } from "./pool.js";
import { hashPassword } from "../lib/passwords.js";

/**
 * Creates (or promotes) an admin account. Credentials come from the environment of this one
 * command so the password never lands in shell history or a committed file:
 *
 *   ADMIN_EMAIL=you@example.com ADMIN_USERNAME=lli_admin ADMIN_PASSWORD='…' npm run admin:create
 *
 * ADMIN_USERNAME is optional (3–32 lowercase letters, digits or _). If the email already exists, that
 * account becomes an admin, its password (and username, when given) is replaced and its sessions are revoked.
 */
const input = z.object({
  ADMIN_EMAIL: z.string().trim().toLowerCase().pipe(z.email()),
  ADMIN_USERNAME: z.string().trim().toLowerCase().regex(/^[a-z0-9_]{3,32}$/, "ADMIN_USERNAME must be 3–32 lowercase letters, digits or _").optional(),
  ADMIN_PASSWORD: z.string().min(12, "ADMIN_PASSWORD must be at least 12 characters").max(128),
  ADMIN_NAME: z.string().trim().min(1).max(80).default("Administrator"),
}).parse(process.env);

try {
  const hash = await hashPassword(input.ADMIN_PASSWORD);
  const { rows } = await query<{ id: string }>(
    `INSERT INTO users (email, username, name, password_hash, role) VALUES ($1,$2,$3,$4,'admin')
     ON CONFLICT (email) DO UPDATE
       SET role = 'admin', password_hash = EXCLUDED.password_hash, username = COALESCE(EXCLUDED.username, users.username),
           token_version = users.token_version + 1, failed_logins = 0, locked_until = NULL, updated_at = now()
     RETURNING id`,
    [input.ADMIN_EMAIL, input.ADMIN_USERNAME ?? null, input.ADMIN_NAME, hash],
  );
  await query("UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [rows[0]!.id]);
  console.log(`Admin ready: ${input.ADMIN_USERNAME ?? input.ADMIN_EMAIL}`);
} catch (err) {
  const e = err as { code?: string; constraint?: string; message: string };
  console.error(e.code === "23505" && e.constraint === "users_username_key" ? "Failed: that username is already taken." : `Failed: ${e.message}`);
  process.exitCode = 1;
} finally {
  await closePool();
}
