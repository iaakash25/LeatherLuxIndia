import { rateLimit } from "express-rate-limit";
import { env } from "../config/env.js";

const handler = (message: string) => (_req: unknown, res: import("express").Response) => {
  res.status(429).json({ error: { code: "rate_limited", message } });
};

// In-memory counters: correct for a single API process. Behind several instances,
// swap in a shared store (e.g. rate-limit-redis) so limits are enforced globally.
const base = { standardHeaders: "draft-8", legacyHeaders: false } as const;

export const globalLimiter = () =>
  rateLimit({ ...base, windowMs: 60_000, limit: env().RATE_LIMIT_GLOBAL_PER_MIN, handler: handler("Too many requests, slow down") });

/** Login/register/refresh/password endpoints: brute-force and credential-stuffing protection. */
export const authLimiter = () =>
  rateLimit({ ...base, windowMs: 15 * 60_000, limit: env().RATE_LIMIT_AUTH_PER_15MIN, handler: handler("Too many attempts, try again in a few minutes") });

/** Registering a visit: a person needs this once per session, so a low cap stops anyone inflating the count. */
export const visitLimiter = () =>
  rateLimit({ ...base, windowMs: 60 * 60_000, limit: 30, handler: handler("Too many requests, try again later") });

export const newsletterLimiter = () =>
  rateLimit({ ...base, windowMs: 60 * 60_000, limit: env().RATE_LIMIT_NEWSLETTER_PER_HOUR, handler: handler("Too many requests, try again later") });
