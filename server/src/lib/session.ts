import crypto from "node:crypto";
import type { CookieOptions, Request, Response } from "express";
import { env } from "../config/env.js";
import { query, type Queryable } from "../db/pool.js";
import { ACCESS_COOKIE, REFRESH_COOKIE } from "../middleware/auth.js";
import type { Role } from "./roles.js";
import { newRefreshToken, signAccessToken } from "./tokens.js";

export type SessionUser = { id: string; role: Role; token_version: number };

const clientCtx = (req: Request) => ({ ip: req.ip ?? null, ua: req.get("user-agent")?.slice(0, 300) ?? null });

function cookieBase(): CookieOptions {
  const e = env();
  return {
    httpOnly: true,
    secure: e.cookieSecure,
    sameSite: e.COOKIE_SAMESITE,
    ...(e.COOKIE_DOMAIN ? { domain: e.COOKIE_DOMAIN } : {}),
  };
}

/**
 * Creates a refresh-token row (new family unless `familyId` is given) and sets both cookies.
 * Pass the transaction client when rotating so the swap is atomic. Returns the new row id.
 */
export async function issueSession(req: Request, res: Response, user: SessionUser, opts: { familyId?: string; db?: Queryable } = {}): Promise<string> {
  const e = env();
  const { token, hash } = newRefreshToken();
  const { ip, ua } = clientCtx(req);
  const ttlMs = e.REFRESH_TOKEN_TTL_DAYS * 86_400_000;
  const { rows } = await query<{ id: string }>(
    `INSERT INTO refresh_tokens (user_id, family_id, token_hash, expires_at, user_agent, ip)
     VALUES ($1, $2, $3, now() + ($4 || ' milliseconds')::interval, $5, $6) RETURNING id`,
    [user.id, opts.familyId ?? crypto.randomUUID(), hash, String(ttlMs), ua, ip],
    opts.db,
  );
  const access = await signAccessToken({ sub: user.id, role: user.role, tv: user.token_version });
  res.cookie(ACCESS_COOKIE, access, { ...cookieBase(), path: "/", maxAge: e.ACCESS_TOKEN_TTL_MINUTES * 60_000 });
  // Refresh cookie is only ever sent to the auth endpoints.
  res.cookie(REFRESH_COOKIE, token, { ...cookieBase(), path: "/api/auth", maxAge: ttlMs });
  return rows[0]!.id;
}

export function clearSession(res: Response) {
  res.clearCookie(ACCESS_COOKIE, { ...cookieBase(), path: "/" });
  res.clearCookie(REFRESH_COOKIE, { ...cookieBase(), path: "/api/auth" });
}

export async function audit(req: Request, action: string, userId: string | null, meta: Record<string, unknown> = {}) {
  const { ip, ua } = clientCtx(req);
  await query("INSERT INTO audit_log (user_id, action, ip, user_agent, meta) VALUES ($1,$2,$3,$4,$5)", [userId, action, ip, ua, JSON.stringify(meta)]);
}
