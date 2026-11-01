import type { RequestHandler } from "express";
import { env } from "../config/env.js";
import { forbidden } from "../lib/errors.js";
import { ACCESS_COOKIE, REFRESH_COOKIE } from "./auth.js";

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * CSRF defence for cookie auth. Browsers always attach `Origin` to cross-site and
 * same-site state-changing requests and scripts cannot forge it, so:
 *  - if an Origin is sent it must be on the allow-list, and
 *  - a state-changing request that carries our auth cookies must have an Origin.
 * (SameSite cookies are a second layer, not the only one.)
 */
export const originCheck: RequestHandler = (req, _res, next) => {
  if (SAFE.has(req.method)) return next();
  const allowed = env().corsOrigins;
  const origin = req.get("origin");
  if (origin !== undefined) {
    if (!allowed.includes(origin)) throw forbidden("Origin not allowed");
    return next();
  }
  if (req.cookies?.[ACCESS_COOKIE] || req.cookies?.[REFRESH_COOKIE]) throw forbidden("Origin header required");
  next();
};
