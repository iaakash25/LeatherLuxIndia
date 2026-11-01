import { env } from "./config/env.js";

// Validate configuration before anything else so a bad .env fails with a readable message.
let cfg: ReturnType<typeof env>;
try {
  cfg = env();
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}

const { createApp } = await import("./app.js");
const { closePool, getPool, query } = await import("./db/pool.js");
const { logger, pruneLogs } = await import("./lib/logger.js");

try {
  await getPool().query("SELECT 1");
} catch (err) {
  const e = err as NodeJS.ErrnoException;
  logger.fatal(
    { code: e.code, message: e.message },
    `Cannot reach Postgres at ${cfg.DB_HOST}:${cfg.DB_PORT}. Check DB_* in .env, the EC2 security group, pg_hba.conf and DB_SSL_MODE (run "npm run db:check").`,
  );
  process.exit(1);
}

const server = createApp().listen(cfg.PORT, cfg.HOST, () => {
  if (cfg.logToFiles) { const removed = pruneLogs(); logger.info({ dir: cfg.logDir, timeZone: cfg.LOG_TIMEZONE, retentionDays: cfg.LOG_RETENTION_DAYS, removed }, "writing daily log files"); }
  logger.info({ port: cfg.PORT, env: cfg.NODE_ENV }, "LLX API listening");
});
// Slowloris / hung-connection protection.
server.requestTimeout = 30_000;
server.headersTimeout = 15_000;
server.keepAliveTimeout = 65_000; // above typical ALB/nginx idle timeouts (60s)

// Hourly housekeeping: drop refresh tokens that expired more than a day ago.
const janitor = setInterval(() => {
  query("DELETE FROM refresh_tokens WHERE expires_at < now() - interval '1 day'").catch((err) => logger.warn({ err: err.message }, "token cleanup failed"));
  pruneLogs();
}, 3_600_000);
janitor.unref();

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, "shutting down");
  const force = setTimeout(() => process.exit(1), 10_000);
  force.unref();
  server.close(async () => {
    await closePool().catch(() => undefined);
    process.exit(0);
  });
  server.closeIdleConnections();
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("unhandledRejection", (reason) => logger.error({ reason: String(reason) }, "unhandled rejection"));
process.on("uncaughtException", (err) => {
  logger.fatal({ err: err.message, stack: err.stack }, "uncaught exception");
  process.exit(1);
});
