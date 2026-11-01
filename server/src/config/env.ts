import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

// server/ (works from both src/config and dist/config)
const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const validZone = (z0: string) => { try { new Intl.DateTimeFormat("en", { timeZone: z0 }); return true; } catch { return false; } };

const bool = z.enum(["true", "false"]).default("false").transform((v) => v === "true");
const boolOn = z.enum(["true", "false"]).default("true").transform((v) => v === "true");
const int = (min: number, max: number) => z.coerce.number().int().min(min).max(max);
// dotenv yields "" for `KEY=`; treat that as "not set".
const optional = z.string().trim().transform((v) => (v === "" ? undefined : v)).optional();

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: int(1, 65535).default(4000),
  HOST: z.string().min(1).default("0.0.0.0"),
  TRUST_PROXY: int(0, 10).default(0),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  // Daily log files: <LOG_DIR>/app-YYYY-MM-DD.log (everything) and error-YYYY-MM-DD.log (errors only).
  LOG_TO_FILES: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
  // Product photos (optimised by `npm run products:import`) are served from here at /media.
  MEDIA_DIR: z.string().trim().min(1).default("media"),
  LOG_DIR: z.string().trim().min(1).default("logs"),
  LOG_RETENTION_DAYS: int(0, 3650).default(30),
  LOG_TIMEZONE: z.string().trim().refine(validZone, "LOG_TIMEZONE must be an IANA time zone, e.g. Asia/Kolkata").default("Asia/Kolkata"),

  // In-memory caching so pages don't query Postgres on every view (see src/lib/caches.ts).
  CACHE_ENABLED: boolOn,
  CACHE_TTL_SECONDS: int(0, 86_400).default(60),       // how long catalogue / branding are served from memory
  CACHE_STALE_SECONDS: int(0, 86_400).default(300),    // extra time an expired copy may be served while it refreshes
  AUTH_CACHE_SECONDS: int(0, 300).default(5),          // who a login cookie belongs to; keep short

  DB_HOST: z.string().trim().min(1, "DB_HOST is required"),
  DB_PORT: int(1, 65535).default(5432),
  DB_NAME: z.string().trim().min(1, "DB_NAME is required"),
  DB_USER: z.string().trim().min(1, "DB_USER is required"),
  DB_PASSWORD: z.string().min(1, "DB_PASSWORD is required"),
  DB_SSL_MODE: z.enum(["disable", "require", "verify-full"]).default("verify-full"),
  DB_SSL_CA_PATH: optional,
  DB_SSL_SERVERNAME: optional,
  DB_POOL_MAX: int(1, 100).default(10),
  DB_POOL_IDLE_MS: int(1000, 600_000).default(30_000),
  DB_CONNECT_TIMEOUT_MS: int(500, 60_000).default(10_000),
  DB_STATEMENT_TIMEOUT_MS: int(500, 120_000).default(15_000),

  JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET must be at least 32 characters"),
  PASSWORD_PEPPER: z.string().min(32, "PASSWORD_PEPPER must be at least 32 characters"),

  ACCESS_TOKEN_TTL_MINUTES: int(1, 120).default(15),
  REFRESH_TOKEN_TTL_DAYS: int(1, 90).default(14),
  COOKIE_SECURE: bool,
  COOKIE_SAMESITE: z.enum(["lax", "strict", "none"]).default("lax"),
  COOKIE_DOMAIN: optional,

  CORS_ORIGINS: z.string().default(""),

  RATE_LIMIT_GLOBAL_PER_MIN: int(1, 100_000).default(300),
  RATE_LIMIT_AUTH_PER_15MIN: int(1, 10_000).default(20),
  RATE_LIMIT_NEWSLETTER_PER_HOUR: int(1, 10_000).default(10),

  // false = the shop is open for browsing and saving a bag, but placing an order is refused (pre-launch). Set to true on launch day.
  ORDERS_OPEN: boolOn,

  SHIPPING_FREE_THRESHOLD_INR: int(0, 10_000_000).default(2500),
  SHIPPING_FLAT_INR: int(0, 100_000).default(150),
});

const PLACEHOLDER = /^(change-?me|changeme|replace[-_ ]?me|password|secret|xxx+|your[-_ ])/i;

export type Env = ReturnType<typeof parseEnv>;

export function parseEnv(source: NodeJS.ProcessEnv = process.env) {
  const result = schema.safeParse(source);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join("\n")}\nSee server/.env.example.`);
  }
  const e = result.data;
  const isProd = e.NODE_ENV === "production";

  const origins = e.CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean);
  for (const o of origins) {
    let u: URL;
    try { u = new URL(o); } catch { throw new Error(`CORS_ORIGINS contains an invalid origin: "${o}"`); }
    if (u.origin !== o) throw new Error(`CORS_ORIGINS entries must be bare origins (scheme://host[:port]), got "${o}"`);
  }

  const problems: string[] = [];
  if (PLACEHOLDER.test(e.DB_PASSWORD) && isProd) problems.push("DB_PASSWORD is still a placeholder");
  if (e.JWT_ACCESS_SECRET === e.PASSWORD_PEPPER) problems.push("JWT_ACCESS_SECRET and PASSWORD_PEPPER must differ");
  if (isProd) {
    if (e.DB_SSL_MODE === "disable") problems.push("DB_SSL_MODE=disable is not allowed in production");
    if (origins.length === 0) problems.push("CORS_ORIGINS must list your frontend origin(s) in production");
    if (origins.some((o) => !o.startsWith("https://"))) problems.push("CORS_ORIGINS must be https:// in production");
    if (e.COOKIE_DOMAIN?.startsWith("http")) problems.push("COOKIE_DOMAIN must be a bare domain");
  }
  if (e.COOKIE_SAMESITE === "none" && !(e.COOKIE_SECURE || isProd)) {
    problems.push("COOKIE_SAMESITE=none requires COOKIE_SECURE=true");
  }
  if (e.DB_SSL_MODE === "verify-full" && !e.DB_SSL_CA_PATH && /^[\d.]+$/.test(e.DB_HOST)) {
    problems.push("DB_SSL_MODE=verify-full with an IP address needs DB_SSL_SERVERNAME (certificate name) and DB_SSL_CA_PATH");
  }
  if (problems.length) throw new Error(`Unsafe environment configuration:\n${problems.map((p) => `  - ${p}`).join("\n")}`);

  return {
    ...e,
    isProd,
    isTest: e.NODE_ENV === "test",
    corsOrigins: origins,
    // Files are on by default, except in tests (which must not litter the disk).
    logToFiles: e.LOG_TO_FILES ?? e.NODE_ENV !== "test",
    logDir: path.resolve(SERVER_ROOT, e.LOG_DIR),
    mediaDir: path.resolve(SERVER_ROOT, e.MEDIA_DIR),
    cookieSecure: isProd || e.COOKIE_SECURE,
  };
}

let cached: Env | undefined;
/** Parsed lazily so importing a module never fails before dotenv/tests set up the environment. */
export function env(): Env {
  return (cached ??= parseEnv());
}
export function resetEnvCache() { cached = undefined; }
