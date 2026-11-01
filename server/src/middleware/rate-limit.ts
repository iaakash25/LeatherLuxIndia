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

/** Registering a visit: a person needs this once per session, so a low cap stops anyone inflating the count. */
export const visitLimiter = () =>
  rateLimit({ ...base, ...shared("visit"), windowMs: 60 * 60_000, limit: 30, handler: handler("Too many requests, try again later") });

export const newsletterLimiter = () =>
  rateLimit({ ...base, ...shared("newsletter"), windowMs: 60 * 60_000, limit: env().RATE_LIMIT_NEWSLETTER_PER_HOUR, handler: handler("Too many requests, try again later") });
