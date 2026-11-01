import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { env } from "../config/env.js";
import { query } from "../db/pool.js";
import { invalidateVisitors, visitsCache } from "../lib/caches.js";
import { visitLimiter } from "../middleware/rate-limit.js";

/**
 * Total unique visitors, for the storefront footer.
 *
 * A "visitor" is one browser: it makes up a random id, keeps it in its own localStorage and reports it
 * here. We store only HMAC(id) — never the id, IP address or user agent — so a database leak says nothing
 * about anyone. It is a simple counter, not analytics: clearing site data counts as a new visitor.
 */
export const visitsRouter = Router();

// Crawlers, uptime monitors and link-preview fetchers would otherwise inflate the number.
const NOT_A_PERSON = /bot|crawl|spider|slurp|headless|lighthouse|pingdom|uptime|monitor|preview|curl|wget|python|httpclient|axios|node-fetch/i;

const total = () => visitsCache.get("total", async () => Number((await query<{ n: string }>("SELECT count(*) AS n FROM site_visitors")).rows[0]!.n));

visitsRouter.get("/", async (_req, res) => {
  res.set("Cache-Control", "public, max-age=15");
  res.json({ total: await total() });
});

visitsRouter.post("/", visitLimiter(), async (req, res) => {
  const { visitorId } = z.object({ visitorId: z.uuid() }).parse(req.body);

  // Honour the browser's own privacy signals, and don't count machines.
  const optedOut = req.get("dnt") === "1" || req.get("sec-gpc") === "1";
  const ua = req.get("user-agent") ?? "";
  if (optedOut || !ua || NOT_A_PERSON.test(ua)) {
    res.set("Cache-Control", "no-store").json({ total: await total(), counted: false });
    return;
  }

  const hash = crypto.createHmac("sha256", env().PASSWORD_PEPPER).update(`visitor:${visitorId.toLowerCase()}`).digest("hex");
  const { rows } = await query<{ inserted: boolean }>(
    `INSERT INTO site_visitors (visitor_hash) VALUES ($1)
     ON CONFLICT (visitor_hash) DO UPDATE SET last_seen = now(), visits = site_visitors.visits + 1
     RETURNING (xmax = 0) AS inserted`,
    [hash],
  );
  if (rows[0]?.inserted) invalidateVisitors(); // a new visitor should see themselves in the number straight away
  res.json({ total: await total(), counted: true });
});
