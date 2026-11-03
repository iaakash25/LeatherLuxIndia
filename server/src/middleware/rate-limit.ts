import { rateLimit } from "express-rate-limit";
import { env } from "../config/env.js";
import { PgRateLimitStore } from "./pg-rate-limit-store.js";

const handler = (message: string) => (_req: unknown, res: import("express").Response) => {
  res.status(429).json({ error: { code: "rate_limited", message } });
};

// Default counters live in this process's memory: right for one long-running API process. Where several instances run side by side
// (Vercel), set RATE_LIMIT_STORE=postgres so the sensitive limiters below count in the database and hold across all of them.
const base = { standardHeaders: "draft-8", legacyHeaders: false } as const;
const shared = (name: string) => (env().RATE_LIMIT_STORE === "postgres" ? { store: new PgRateLimitStore(name) } : {});

/** Every request, per address. Counted in memory even on Vercel (a database write per page view is too costly); the platform's own protection covers floods. */
export const globalLimiter = () =>
  rateLimit({ ...base, windowMs: 60_000, limit: env().RATE_LIMIT_GLOBAL_PER_MIN, handler: handler("Too many requests, slow down") });

/** Login/register/refresh/password endpoints: brute-force and credential-stuffing protection. */
export const authLimiter = () =>
  rateLimit({ ...base, ...shared("auth"), windowMs: 15 * 60_000, limit: env().RATE_LIMIT_AUTH_PER_15MIN, handler: handler("Too many attempts, try again in a few minutes") });

/** Counting a page load: every load and refresh counts, so the cap is generous (20 a minute on average for one address, which is also a whole office
 *  behind one router); it only stops a script from running the number up. */
export const visitLimiter = () =>
  rateLimit({ ...base, ...shared("visit"), windowMs: 60 * 60_000, limit: 1200, handler: handler("Too many requests, try again later") });

/** Logging a page view writes a row, so one address may log at most 3,000 an hour (50 a minute: a keen shopper opens a page a second). Counted in memory,
 *  like the global limit, so the log's own protection costs no database write. */
export const pageViewLimiter = () =>
  rateLimit({ ...base, windowMs: 60 * 60_000, limit: 3000, handler: handler("Too many requests, try again later") });

export const newsletterLimiter = () =>
  rateLimit({ ...base, ...shared("newsletter"), windowMs: 60 * 60_000, limit: env().RATE_LIMIT_NEWSLETTER_PER_HOUR, handler: handler("Too many requests, try again later") });
