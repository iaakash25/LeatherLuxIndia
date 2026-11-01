import type { NextFunction, Request, RequestHandler, Response } from "express";
import { query } from "../db/pool.js";
import { authUserCache } from "../lib/caches.js";
import { AppError, forbidden, unauthorized } from "../lib/errors.js";
import type { Role } from "../lib/roles.js";
import { verifyAccessToken } from "../lib/tokens.js";

export const ACCESS_COOKIE = "llx_at";
export const REFRESH_COOKIE = "llx_rt";

export type AuthUser = { id: string; email: string; username: string | null; name: string; role: Role; mustChangePassword: boolean };

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

/**
 * Verifies the access-token cookie, then re-reads the user so that password changes,
 * "log out everywhere" (token_version bump) and role changes take effect immediately.
 */
export const requireAuth: RequestHandler = async (req: Request, _res: Response, next: NextFunction) => {
  const raw: unknown = req.cookies?.[ACCESS_COOKIE];
  if (typeof raw !== "string" || raw.length > 2048) throw unauthorized();
  const claims = await verifyAccessToken(raw);
  if (!claims) throw unauthorized();
  // Held for a few seconds so a page's burst of calls (me, bag, wishlist…) costs one lookup, not one each.
  // Password changes and "sign out everywhere" clear it at once (invalidateUser); see AUTH_CACHE_SECONDS.
  const u = await authUserCache.get(claims.sub, async () => (await query<AuthUser & { token_version: number }>(
    `SELECT id, email, username, name, role, token_version, must_change_password AS "mustChangePassword" FROM users WHERE id = $1`,
    [claims.sub],
  )).rows[0] ?? null);
  if (!u || u.token_version !== claims.tv) throw unauthorized();
  req.user = { id: u.id, email: u.email, username: u.username, name: u.name, role: u.role, mustChangePassword: u.mustChangePassword };
  next();
};

export const requireAdmin: RequestHandler = (req, _res, next) => {
  if (!req.user) throw unauthorized();
  if (req.user.role !== "admin") throw forbidden();
  // A freshly added admin still has the shared default password: no admin access until they choose their own.
  if (req.user.mustChangePassword) throw new AppError(403, "password_change_required", "Change your default password before using the admin console.");
  next();
};

/** Handler helper: the authenticated user, guaranteed by requireAuth. */
export function me(req: Request): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}
