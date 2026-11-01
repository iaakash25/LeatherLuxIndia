import fs from "node:fs";
import pg from "pg";
import type { QueryResultRow } from "pg";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";

let pool: pg.Pool | undefined;

function sslConfig(): pg.ConnectionConfig["ssl"] {
  const e = env();
  if (e.DB_SSL_MODE === "disable") return false;
  const ca = e.DB_SSL_CA_PATH ? fs.readFileSync(e.DB_SSL_CA_PATH, "utf8") : undefined;
  return {
    // `require` encrypts but does not authenticate the server (typical self-signed EC2 cert).
    // `verify-full` authenticates the certificate chain and the hostname.
    rejectUnauthorized: e.DB_SSL_MODE === "verify-full",
    ...(ca ? { ca } : {}),
    ...(e.DB_SSL_SERVERNAME ? { servername: e.DB_SSL_SERVERNAME } : {}),
    minVersion: "TLSv1.2",
  };
}

export function getPool(): pg.Pool {
  if (pool) return pool;
  const e = env();
  if (e.DB_SSL_MODE === "require") {
    logger.warn("DB_SSL_MODE=require: traffic to Postgres is encrypted but the server is not verified. Use verify-full with DB_SSL_CA_PATH.");
  }
  pool = new pg.Pool({
    host: e.DB_HOST,
    port: e.DB_PORT,
    database: e.DB_NAME,
    user: e.DB_USER,
    password: e.DB_PASSWORD,
    ssl: sslConfig(),
    max: e.DB_POOL_MAX,
    idleTimeoutMillis: e.DB_POOL_IDLE_MS,
    connectionTimeoutMillis: e.DB_CONNECT_TIMEOUT_MS,
    statement_timeout: e.DB_STATEMENT_TIMEOUT_MS,
    query_timeout: e.DB_STATEMENT_TIMEOUT_MS + 2000,
    idle_in_transaction_session_timeout: e.DB_STATEMENT_TIMEOUT_MS * 2,
    application_name: "llx-api",
  });
  // An idle client erroring (e.g. EC2 restarts Postgres) must not crash the process.
  pool.on("error", (err) => logger.error({ err: { message: err.message, code: (err as NodeJS.ErrnoException).code } }, "idle postgres client error"));
  return pool;
}

export type Queryable = Pick<pg.Pool | pg.PoolClient, "query">;

/** Statements issued through `query()` since start. Lets the admin cache report show how many database calls caching avoided. */
export const dbStats = { queries: 0 };

/** Always use parameter placeholders ($1, $2, …); never interpolate user input into `text`. */
export async function query<R extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = [], q: Queryable = getPool()) {
  dbStats.queries++;
  return q.query<R>(text, params);
}

export async function withTx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export async function closePool() {
  if (!pool) return;
  const p = pool;
  pool = undefined;
  await p.end();
}
