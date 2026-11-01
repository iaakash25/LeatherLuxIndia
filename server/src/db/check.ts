import { env } from "../config/env.js";
import { closePool, getPool } from "./pool.js";

/** `npm run db:check` — verifies .env can reach the EC2 Postgres instance, over TLS, with the right role. */
async function main() {
  const e = env();
  console.log(`Connecting to ${e.DB_HOST}:${e.DB_PORT}/${e.DB_NAME} as ${e.DB_USER} (ssl: ${e.DB_SSL_MODE}) …`);
  const pool = getPool();
  const { rows } = await pool.query<{ version: string; ssl: boolean | null; me: string }>(
    `SELECT version(), (SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()) AS ssl, current_user AS me`,
  );
  const r = rows[0]!;
  console.log(`OK  ${r.version.split(",")[0]}`);
  console.log(`    role: ${r.me}   tls: ${r.ssl ? "yes" : "NO"}`);
  if (!r.ssl && e.DB_SSL_MODE !== "disable") console.warn("    warning: connection is not encrypted");
}

main()
  .catch((err: NodeJS.ErrnoException) => {
    // Never print the password; pg errors don't include it, but keep output minimal anyway.
    console.error(`FAILED: ${err.code ?? ""} ${err.message}`);
    console.error("Check DB_HOST/DB_PORT, the EC2 security group (port 5432 from this machine), pg_hba.conf, and DB_SSL_* settings.");
    process.exitCode = 1;
  })
  .finally(closePool);
