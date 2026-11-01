import crypto from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { env } from "../config/env.js";
import type { Role } from "./roles.js";

const ISSUER = "llx-api";
const AUDIENCE = "llx-web";
const key = () => new TextEncoder().encode(env().JWT_ACCESS_SECRET);

export type AccessClaims = { sub: string; role: Role; tv: number };

export async function signAccessToken(c: AccessClaims): Promise<string> {
  return new SignJWT({ role: c.role, tv: c.tv })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(c.sub)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${env().ACCESS_TOKEN_TTL_MINUTES}m`)
    .sign(key());
}

/** Returns claims, or null for any invalid/expired/tampered token (never throws). */
export async function verifyAccessToken(token: string): Promise<AccessClaims | null> {
  try {
    const { payload } = await jwtVerify(token, key(), { issuer: ISSUER, audience: AUDIENCE, algorithms: ["HS256"] });
    const { sub, role, tv } = payload as { sub?: string; role?: string; tv?: number };
    // "customer" is the pre-roles-table name for "user"; tokens minted before migration 002 stay valid until they expire.
    if (!sub || (role !== "user" && role !== "customer" && role !== "admin") || typeof tv !== "number") return null;
    return { sub, role: role === "customer" ? "user" : role, tv };
  } catch {
    return null;
  }
}

/** 256-bit opaque token; only its SHA-256 is stored, so a DB leak can't be replayed. */
export function newRefreshToken(): { token: string; hash: string } {
  const token = crypto.randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
}
export const hashToken = (t: string) => crypto.createHash("sha256").update(t).digest("hex");
