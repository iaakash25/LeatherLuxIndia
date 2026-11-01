/**
 * Security headers for every response the storefront serves (applied in src/server.ts, production builds only: the dev server needs
 * inline scripts and a websocket that this policy would block).
 *
 * If the site starts using another outside host (analytics, a map, a payment page, another image or font host), add it here or the
 * browser will refuse to load it. That is the policy doing its job.
 */
export function securityHeaders(apiOrigin: string): Record<string, string> {
  const api = apiOrigin ? ` ${apiOrigin}` : "";
  const csp = [
    "default-src 'self'",
    // The framework's hydration scripts are inline and carry per-page data, so they cannot be allow-listed by hash and 'unsafe-inline'
    // is needed. There is no 'unsafe-eval', and no other origin may supply a script.
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    // Product photos and the logo come from the API.
    `img-src 'self' data: blob:${api}`,
    `connect-src 'self'${api}`,
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    // Not when the API is plain http (a local test build), which this would break.
    ...(apiOrigin.startsWith("http://") ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");

  return {
    "Content-Security-Policy": csp,
    "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "Cross-Origin-Opener-Policy": "same-origin",
  };
}
