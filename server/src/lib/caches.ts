import crypto from "node:crypto";
import type { Request, Response } from "express";
import { env } from "../config/env.js";
import type { AuthUser } from "../middleware/auth.js";
import { TtlCache } from "./cache.js";

// What is cached, and what must clear it:
//   catalogue  product lists and product pages   cleared by: admin product edits, orders placed or cancelled
//   branding   store name + logo                 cleared by: admin branding edits
//   visitors   the footer's total                cleared by: a page load being counted
//   signed-in users  who a login cookie belongs to  cleared by: change-password, sign-out-everywhere
// Anything that writes to those tables from the API MUST call the matching invalidate…() below.
// (Changes made outside the API, e.g. straight SQL, show up when the time-to-live runs out, or on an admin "purge".)

const c = env();
const ttlMs = c.CACHE_ENABLED ? c.CACHE_TTL_SECONDS * 1000 : 0;
const staleMs = c.CACHE_STALE_SECONDS * 1000;
const authMs = c.CACHE_ENABLED ? c.AUTH_CACHE_SECONDS * 1000 : 0;

/** A JSON response body already serialised, with its ETag, so a repeat request costs no query and no stringify. */
export type CachedBody = { body: string; etag: string };
export type CachedLogo = { data: Buffer; type: string; etag: string };
export type CachedUser = AuthUser & { token_version: number };

const etagOf = (data: string | Buffer) => `W/"${crypto.createHash("sha1").update(data).digest("hex").slice(0, 20)}"`;

export function cachedJson(value: unknown): CachedBody {
  const body = JSON.stringify(value);
  return { body, etag: etagOf(body) };
}
export const cachedLogo = (data: Buffer, type: string): CachedLogo => ({ data, type, etag: etagOf(data) });

/**
 * Sends a cached JSON body. A browser (or CDN) that already has this exact version sends `If-None-Match` and gets an
 * empty 304 — still without touching the database.
 */
export function sendCached(req: Request, res: Response, cached: CachedBody, cacheControl: string): void {
  res.set({ "Cache-Control": cacheControl, ETag: cached.etag }).type("json");
  if (req.fresh) { res.status(304).end(); return; }
  res.send(cached.body);
}

export const catalogCache = new TtlCache<CachedBody | null>({ name: "catalogue", ttlMs, staleMs, maxEntries: 500 });
export const brandCache = new TtlCache<CachedBody>({ name: "branding", ttlMs, staleMs, maxEntries: 2 });
export const logoCache = new TtlCache<CachedLogo | null>({ name: "logo", ttlMs, staleMs, maxEntries: 2 });
export const visitsCache = new TtlCache<number>({ name: "visitors", ttlMs: ttlMs ? Math.min(ttlMs, 10_000) : 0, maxEntries: 2 });
// Short on purpose: it decides who is allowed in, so a role change made straight in the database applies within seconds.
export const authUserCache = new TtlCache<CachedUser | null>({ name: "signed-in users", ttlMs: authMs, maxEntries: 5000 });

export const allCaches = [catalogCache, brandCache, logoCache, visitsCache, authUserCache] as const;

export const invalidateCatalog = () => { catalogCache.invalidate(); };
export const invalidateBranding = () => { brandCache.invalidate(); logoCache.invalidate(); };
export const invalidateVisitors = () => { visitsCache.invalidate(); };
export const invalidateUser = (id: string) => { authUserCache.invalidate(id); };
export const purgeAll = () => { for (const cache of allCaches) cache.invalidate(); };
