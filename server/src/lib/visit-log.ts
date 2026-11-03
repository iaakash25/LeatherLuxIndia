import { isIP } from "node:net";
import type { Request } from "express";
import { env } from "../config/env.js";
import { query } from "../db/pool.js";
import { logger } from "./logger.js";

/**
 * The visit log (table visit_log, migration 009): the address, page, date and time of every page view, as reported by the storefront.
 * See docs/visit-log.md for what is stored, why, and how to read it.
 */

/** Crawlers, uptime monitors and link-preview fetchers: logged, but marked so they can be left out of any count. */
export const NOT_A_PERSON = /bot|crawl|spider|slurp|headless|lighthouse|pingdom|uptime|monitor|preview|curl|wget|python|httpclient|axios|node-fetch/i;

/**
 * The visitor's address. Express works it out from the platform's forwarding header (TRUST_PROXY says how many proxies to believe, so a visitor
 * cannot choose their own), and a plain IPv4 address that arrives in IPv6 clothing (::ffff:203.0.113.7) is written as IPv4. Null if it is not an address.
 */
export function clientIp(req: Pick<Request, "ip">): string | null {
  const raw = (req.ip ?? "").replace(/^::ffff:/i, "").trim();
  return isIP(raw) ? raw : null;
}

/** "/products/aria-top-handle?x=1#top" → "/products/aria-top-handle". Null for anything that is not a plain page path. */
export function cleanPath(raw: string): string | null {
  const p = raw.split(/[?#]/)[0] ?? "";
  return p.startsWith("/") && !p.startsWith("//") && p.length <= 300 && !/[\s\u0000-\u001f\u007f]/.test(p) ? p : null;
}

/** The site a visitor came from, reduced to its address ("https://www.google.com"): never the page or the search words in it. Null if not a plain web address. */
export function cleanReferrer(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return (u.protocol === "https:" || u.protocol === "http:") && u.origin.length <= 300 ? u.origin : null;
  } catch {
    return null;
  }
}

export type PageView = { ip: string; path: string; referrer: string | null; userAgent: string | null; at?: Date };

export async function recordPageView(v: PageView): Promise<void> {
  const ua = v.userAgent ? v.userAgent.slice(0, 400) : null;
  await query(
    "INSERT INTO visit_log (visited_at, ip, path, referrer, user_agent, is_bot) VALUES (COALESCE($1, now()), $2, $3, $4, $5, $6)",
    [v.at ?? null, v.ip, v.path, v.referrer, ua, !ua || NOT_A_PERSON.test(ua)],
  );
  // Housekeeping on about 1 request in 200, in small batches, so the table does not grow for ever and no request waits on a big delete.
  if (Math.random() < 1 / 200) void pruneVisitLog().catch((err) => logger.warn({ err: (err as Error).message }, "visit log pruning failed"));
}

/** Deletes entries older than the retention period (VISIT_LOG_RETENTION_DAYS; 0 keeps everything). Returns how many were deleted. */
export async function pruneVisitLog(now = new Date()): Promise<number> {
  const days = env().VISIT_LOG_RETENTION_DAYS;
  if (days <= 0) return 0;
  const cutoff = new Date(now.getTime() - days * 86_400_000);
  const r = await query("DELETE FROM visit_log WHERE id IN (SELECT id FROM visit_log WHERE visited_at < $1 ORDER BY visited_at LIMIT 5000)", [cutoff]);
  return r.rowCount ?? 0;
}
