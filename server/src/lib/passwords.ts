import crypto from "node:crypto";
import { promisify } from "node:util";
import { env } from "../config/env.js";

const scrypt = promisify(crypto.scrypt) as (pw: crypto.BinaryLike, salt: crypto.BinaryLike, keylen: number, opts: crypto.ScryptOptions) => Promise<Buffer>;

// OWASP-recommended scrypt cost (N=2^17 is their ideal; 2^15 keeps login latency/memory sane on small EC2 sizes).
const PARAMS = { N: 2 ** 15, r: 8, p: 1 } as const;
const KEYLEN = 64;
const maxmem = 128 * PARAMS.N * PARAMS.r * 2;

/** HMAC with the server-side pepper first: a leaked DB dump alone can't be brute-forced offline. */
function prehash(password: string): Buffer {
  return crypto.createHmac("sha256", env().PASSWORD_PEPPER).update(password, "utf8").digest();
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(prehash(password), salt, KEYLEN, { ...PARAMS, maxmem });
  return ["scrypt", PARAMS.N, PARAMS.r, PARAMS.p, salt.toString("base64"), key.toString("base64")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, saltB64, keyB64] = stored.split("$");
  if (alg !== "scrypt" || !n || !r || !p || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, "base64");
  const opts = { N: Number(n), r: Number(r), p: Number(p), maxmem: 128 * Number(n) * Number(r) * 2 };
  const actual = await scrypt(prehash(password), Buffer.from(saltB64, "base64"), expected.length, opts);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

let dummy: Promise<string> | undefined;
/** Burns the same CPU as a real check so unknown emails aren't distinguishable by response time. */
export async function fakeVerify(password: string): Promise<false> {
  dummy ??= hashPassword("timing-equaliser");
  await verifyPassword(password, await dummy);
  return false;
}
