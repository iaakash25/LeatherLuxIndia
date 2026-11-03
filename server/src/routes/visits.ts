import { Router } from "express";
import { z } from "zod";
import { query } from "../db/pool.js";
import { visitsCache } from "../lib/caches.js";
import { clientIp, cleanPath, cleanReferrer, NOT_A_PERSON, recordPageView } from "../lib/visit-log.js";
import { pageViewLimiter, visitLimiter } from "../middleware/rate-limit.js";

/**
 * "Total visitors" in the storefront footer: a counter that goes up by one every time a page is loaded or refreshed (the browser reports it
 * once per page load). It does not try to tell people apart, so nothing about the visitor is kept: no id, address or browser details, only the
 * number. (The visit log further down is separate, and does keep the address: that is its job.) It is a simple counter, not analytics.
 */
export const visitsRouter = Router();

// (Crawlers, uptime monitors and link-preview fetchers would otherwise inflate the number: NOT_A_PERSON, in lib/visit-log.ts.)

const total = () => visitsCache.get("total", async () => Number((await query<{ n: string }>("SELECT value AS n FROM site_counters WHERE name = 'page_loads'")).rows[0]?.n ?? 0));

visitsRouter.get("/", async (_req, res) => {
  res.set("Cache-Control", "public, max-age=15");
  res.json({ total: await total() });
});

visitsRouter.post("/", visitLimiter(), async (req, res) => {
  res.set("Cache-Control", "no-store");
  const ua = req.get("user-agent") ?? "";
  if (!ua || NOT_A_PERSON.test(ua)) {
    res.json({ total: await total(), counted: false });
    return;
  }
  // One atomic statement, so many pages loading at the same moment each add exactly one.
  const { rows } = await query<{ value: string }>(
    `INSERT INTO site_counters (name, value) VALUES ('page_loads', 1)
     ON CONFLICT (name) DO UPDATE SET value = site_counters.value + 1, updated_at = now()
     RETURNING value`,
  );
  const value = Number(rows[0]!.value);
  visitsCache.invalidate(); // a later read of the total must not show the number from before this load
  res.json({ total: value, counted: true });
});

/**
 * The visit log: the storefront reports every page view here (the first page of a visit and each page after it), and one row is written with the
 * visitor's IP address, the page, the date and time, their browser and, on the first page, the site they came from. Crawlers are logged too, marked.
 * Nothing is read back through the public API; the table is for the shop owner (docs/visit-log.md).
 */
const pageView = z.object({
  path: z.string().max(400).transform((p, ctx) => {
    const clean = cleanPath(p);
    if (clean) return clean;
    ctx.addIssue({ code: "custom", message: "A page path starts with / and has no spaces" });
    return z.NEVER;
  }),
  referrer: z.string().max(600).optional(),
});

visitsRouter.post("/log", pageViewLimiter(), async (req, res) => {
  const { path, referrer } = pageView.parse(req.body);
  const ip = clientIp(req);
  if (ip) await recordPageView({ ip, path, referrer: cleanReferrer(referrer), userAgent: req.get("user-agent") ?? null });
  res.status(204).end(); // nothing to tell the browser, and nothing it should wait for
});
