import { z } from "zod";
import { closePool, query } from "./pool.js";
import { hashPassword } from "../lib/passwords.js";

/**
 * Adds an admin account by hand. Admins can't be created from the website; this is the only way in.
 *
 *   npm run admin:add -- jane@example.com                          (email only)
 *   npm run admin:add -- jane@example.com jane_admin "Jane Doe"    (email, username, name)
 *   npm run admin:add -- jane@example.com jane_admin "Jane Doe" --print-sql
 *
 * The account gets the default password below and must choose its own at first sign-in (the admin console
 * stays locked until it does). `--print-sql` prints a ready-to-run INSERT for psql instead of touching the
 * database. `--promote` turns an existing shopper account into an admin (and resets it to the default password).
 */
const DEFAULT_PASSWORD = "Admin@2026";

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const [rawEmail, rawUsername, rawName] = args.filter((a) => !a.startsWith("--"));

const input = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("First argument must be the admin's email address")),
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9_]{3,32}$/, "Username must be 3-32 lowercase letters, digits or _").optional(),
  name: z.string().trim().min(1).max(80).default("Administrator"),
}).safeParse({ email: rawEmail, username: rawUsername || undefined, name: rawName || undefined });

if (!input.success) {
  console.error(input.error.issues.map((i) => i.message).join("\n"));
  console.error('\nUsage: npm run admin:add -- <email> [username] ["Full Name"] [--print-sql] [--promote]');
  process.exit(1);
}
const { email, username, name } = input.data;
const lit = (s: string | undefined) => (s === undefined ? "NULL" : `'${s.replace(/'/g, "''")}'`);

try {
  const hash = await hashPassword(DEFAULT_PASSWORD);

  if (flags.has("--print-sql")) {
    console.log(
      "-- Run in psql against the store database. Default password: " + DEFAULT_PASSWORD + " (changed at first sign-in)\n" +
      "INSERT INTO users (email, username, name, password_hash, role, must_change_password)\n" +
      `VALUES (${lit(email)}, ${lit(username)}, ${lit(name)}, ${lit(hash)}, 'admin', true);`,
    );
  } else {
    const existing = (await query<{ id: string }>("SELECT id FROM users WHERE email = $1 OR ($2::text IS NOT NULL AND username = $2)", [email, username ?? null])).rows[0];
    if (existing && !flags.has("--promote")) {
      console.error("An account with that email or username already exists. Nothing was changed.\nUse --promote to make an existing account an admin (its password is reset to the default).");
      process.exitCode = 1;
    } else if (existing) {
      await query(
        `UPDATE users SET role = 'admin', password_hash = $2, must_change_password = true, token_version = token_version + 1,
                failed_logins = 0, locked_until = NULL, updated_at = now(), username = COALESCE($3, username)
          WHERE id = $1`,
        [existing.id, hash, username ?? null],
      );
      await query("UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [existing.id]);
      console.log(`Promoted ${email} to admin. Default password set; they must change it at first sign-in.`);
    } else {
      await query(
        "INSERT INTO users (email, username, name, password_hash, role, must_change_password) VALUES ($1,$2,$3,$4,'admin',true)",
        [email, username ?? null, name, hash],
      );
      console.log(`Admin added: ${username ?? email}\nDefault password: ${DEFAULT_PASSWORD}  (they must change it at first sign-in)`);
    }
  }
} catch (err) {
  const e = err as { code?: string; constraint?: string; message: string };
  console.error(e.code === "23505" ? "Failed: that email or username is already taken." : `Failed: ${e.message}`);
  process.exitCode = 1;
} finally {
  await closePool();
}
