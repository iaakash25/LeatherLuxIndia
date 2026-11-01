// Thin client for the LLX API (see server/README.md). Auth lives in httpOnly cookies, so every
// request is sent with credentials and no token ever touches JavaScript.

// Where the API is, decided at build time (so the server and the browser always agree):
//   VITE_API_URL unset  development: the local API (http://localhost:4000).
//                       production: THIS site's own /api. The API is part of the same deployment, on the same domain, so there is
//                       no second address to secure, no CORS, and sign-in cookies work on every domain the site is served from.
//   VITE_API_URL=<url>  a separate API at that address.
//   VITE_API_URL=off    no server at all: guest mode (localStorage, built-in catalogue).
const configured = import.meta.env["VITE_API_URL"] as string | undefined;
const off = configured === "off";
const separate = configured && !off ? configured.replace(/\/+$/, "") : undefined;
/** What the browser puts in front of /api and /media: nothing (same origin), unless the API lives elsewhere. */
const BASE = separate ?? (import.meta.env.DEV ? "http://localhost:4000" : "");

export const apiEnabled = !off;

/** The API's origin when it is NOT this site, or "" when it is. The storefront's security policy lets the browser talk to exactly this and nothing else. */
export const API_ORIGIN = (() => { try { return BASE ? new URL(BASE).origin : ""; } catch { return ""; } })();

/** Address for a path the API returned (the logo, product photos): relative to this site, or to a separate API. */
export const apiUrl = (path: string) => `${BASE}${path}`;

/**
 * What to put in front of /api for a request made right now. In the browser a same-origin API needs nothing. Server rendering has no page
 * to be relative to, so it calls this deployment's own public address (SITE_URL, or Vercel's production address).
 */
function fetchBase(): string {
  if (BASE || !import.meta.env.SSR) return BASE;
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
  const site = env["SITE_URL"] ?? (env["VERCEL_PROJECT_PRODUCTION_URL"] ? `https://${env["VERCEL_PROJECT_PRODUCTION_URL"]}` : "");
  return site.replace(/\/+$/, "");
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: { path: string; message: string }[],
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type Options = { method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; body?: unknown; file?: Blob; headers?: Record<string, string>; timeoutMs?: number };

async function send(path: string, { method = "GET", body, file, headers, timeoutMs }: Options): Promise<Response> {
  try {
    return await fetch(`${fetchBase()}/api${path}`, {
      method,
      credentials: "include",
      headers: { ...(file ? { "Content-Type": file.type } : body === undefined ? {} : { "Content-Type": "application/json" }), ...headers },
      ...(file ? { body: file } : body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
    });
  } catch {
    throw new ApiError(0, "network", "We can't reach the server right now. Please try again.");
  }
}

let refreshing: Promise<boolean> | null = null;
/** One refresh at a time, so parallel 401s don't race the rotating refresh cookie. */
function refreshSession(): Promise<boolean> {
  refreshing ??= send("/auth/refresh", { method: "POST" })
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => { refreshing = null; });
  return refreshing;
}

export async function api<T = void>(path: string, opts: Options = {}): Promise<T> {
  if (!apiEnabled) throw new ApiError(0, "disabled", "The store server isn't configured.");
  let res = await send(path, opts);
  // Access tokens are short-lived: quietly renew once and retry (never for the auth endpoints themselves).
  if (res.status === 401 && !path.startsWith("/auth/") && (await refreshSession())) res = await send(path, opts);
  if (res.status === 204) return undefined as T;
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const e = (json as { error?: { code?: string; message?: string; details?: ApiError["details"] } } | null)?.error;
    throw new ApiError(res.status, e?.code ?? "error", e?.message ?? "Something went wrong. Please try again.", e?.details);
  }
  return json as T;
}

/** A message that is safe to show a shopper. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === "validation_failed" && err.details?.[0]) return err.details[0].message;
    return err.message;
  }
  return "Something went wrong. Please try again.";
}

// ── Types mirroring the server's responses ───────────────────────────────────────────────────────
export type ApiUser = { id: string; email: string; username: string | null; name: string; role: "user" | "admin"; mustChangePassword: boolean };
export type ApiCartItem = { id: string; slug: string; colour: string; size?: string; qty: number; unitPrice: number; stock: "in" | "low" | "out"; available: boolean };
export type ApiCart = { items: ApiCartItem[]; count: number; subtotal: number; shipping: number; total: number; skipped?: string[] };
export type ApiAddress = { name: string; phone: string; line1: string; line2?: string; city: string; state: string; pincode: string };
export type ApiOrderStatus = "pending" | "confirmed" | "shipped" | "delivered" | "cancelled";
export type ApiOrder = {
  id: string;
  orderNumber: string;
  status: ApiOrderStatus;
  paymentStatus: "unpaid" | "paid" | "refunded";
  subtotal: number;
  shipping: number;
  total: number;
  shippingAddress: ApiAddress;
  createdAt: string;
  items: { slug: string; name: string; colour: string; size?: string; qty: number; unitPrice: number }[];
};
export type ApiWishlist = { slugs: string[] };
