import { api, apiEnabled } from "./api";

/**
 * Tells the shop's visit log (server/src/lib/visit-log.ts, docs/visit-log.md) which page was just opened. The server adds the visitor's IP
 * address and the time. Only the page's path goes (never the query string or anything typed into it), and, on the first page of a visit, the
 * address of the site they came from, without its page. A failure is ignored: the log must never get in the way of the page.
 */
let last = { path: "", at: 0 };
let first = true;

export function logPageView(path: string): void {
  if (!apiEnabled || path.startsWith("/admin")) return; // the admin console is not a visitor's page
  const now = Date.now();
  if (path === last.path && now - last.at < 1500) return; // the same page twice in a moment (a double effect run), not two views
  last = { path, at: now };

  let referrer: string | undefined;
  if (first) {
    first = false;
    try {
      const from = document.referrer ? new URL(document.referrer) : null;
      if (from && from.origin !== location.origin) referrer = from.origin;
    } catch { /* no usable referrer */ }
  }
  api("/visits/log", { method: "POST", body: { path, ...(referrer ? { referrer } : {}) }, timeoutMs: 8000 }).catch(() => undefined);
}
