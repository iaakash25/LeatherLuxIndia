import type { ClientRateLimitInfo, Options, Store } from "express-rate-limit";
import { query } from "../db/pool.js";

/**
 * A rate-limit store in Postgres, shared by every server instance (express-rate-limit's default keeps counts in each process's memory).
 * One atomic statement per request: it starts a window on the first hit, counts within it, and starts a fresh one once it has ended.
 * The `prefix` keeps the limiters apart (a login attempt and a newsletter signup from one address are counted separately).
 */
export class PgRateLimitStore implements Store {
  /** Counters are shared between instances, so the library must not assume it can reset them locally. */
  readonly localKeys = false;
  private windowMs = 60_000;
  readonly prefix: string;

  constructor(name: string) { this.prefix = `${name}:`; }

  init(options: Options) { this.windowMs = options.windowMs; }

  async increment(key: string): Promise<ClientRateLimitInfo> {
    const { rows } = await query<{ hits: number; reset_at: Date }>(
      `INSERT INTO rate_limits (key, hits, reset_at) VALUES ($1, 1, now() + ($2 * interval '1 millisecond'))
       ON CONFLICT (key) DO UPDATE SET
         hits     = CASE WHEN rate_limits.reset_at <= now() THEN 1 ELSE rate_limits.hits + 1 END,
         reset_at = CASE WHEN rate_limits.reset_at <= now() THEN now() + ($2 * interval '1 millisecond') ELSE rate_limits.reset_at END
       RETURNING hits, reset_at`,
      [this.prefix + key, this.windowMs],
    );
    // Housekeeping on about 1 request in 100, so the table never grows without a separate job.
    if (Math.random() < 0.01) void query("DELETE FROM rate_limits WHERE reset_at < now() - interval '1 hour'").catch(() => undefined);
    return { totalHits: rows[0]!.hits, resetTime: rows[0]!.reset_at };
  }

  async decrement(key: string): Promise<void> {
    await query("UPDATE rate_limits SET hits = greatest(hits - 1, 0) WHERE key = $1", [this.prefix + key]);
  }

  async resetKey(key: string): Promise<void> {
    await query("DELETE FROM rate_limits WHERE key = $1", [this.prefix + key]);
  }
}
