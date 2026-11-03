import { Router } from "express";
import { z } from "zod";
import { env } from "../config/env.js";
import { query } from "../db/pool.js";
import { AppError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";
import { lookupPincode } from "../lib/pincode.js";
import { validatePincode } from "../lib/validation.js";
import { newsletterLimiter } from "../middleware/rate-limit.js";

export const miscRouter = Router();

/** Always answers the same way, so the endpoint can't be used to learn who is subscribed. */
miscRouter.post("/newsletter", newsletterLimiter(), async (req, res) => {
  const { email } = z.object({ email: z.string().trim().toLowerCase().pipe(z.email().max(254)) }).parse(req.body);
  await query("INSERT INTO newsletter_subscribers (email) VALUES ($1) ON CONFLICT DO NOTHING", [email]);
  res.status(202).json({ ok: true });
});

/** Whether orders can be placed yet. The storefront follows this: it never offers a checkout the server would refuse. */
miscRouter.get("/store-status", (_req, res) => {
  res.set("Cache-Control", "public, max-age=30");
  res.json({ ordersOpen: env().ORDERS_OPEN });
});

/**
 * The city and state a pincode belongs to, so the checkout form can fill them in. A pincode's place never changes, so the answer is cached for
 * a day by this server, the CDN and the browser. 404: no such pincode. 503: the lookup service is down (the shopper types the place instead).
 */
miscRouter.get("/pincode/:pin", async (req, res) => {
  const v = validatePincode(String(req.params["pin"] ?? ""));
  if (!v.ok) throw new AppError(400, "invalid_pincode", v.message);
  const info = await lookupPincode(v.value);
  if (!info) throw new AppError(404, "pincode_not_found", "We couldn't find that pincode. Please check it.");
  res.set("Cache-Control", "public, max-age=86400, s-maxage=86400");
  res.json(info);
});

/** Same sample estimate the storefront shows today: metro-style first digits are faster. */
miscRouter.get("/delivery/estimate", (req, res) => {
  const { pincode } = z.object({ pincode: z.string().transform((raw, ctx) => {
    const r = validatePincode(raw);
    if (r.ok) return r.value;
    ctx.addIssue({ code: "custom", message: r.message });
    return z.NEVER;
  }) }).parse(req.query);
  const metro = ["1", "4", "5", "6"].includes(pincode[0]!);
  res.json({ pincode, minDays: metro ? 2 : 4, maxDays: metro ? 4 : 7, sample: true });
});

export const healthRouter = Router();

healthRouter.get("/", (_req, res) => { res.json({ status: "ok" }); });

/** Readiness: can we reach Postgres? Detail goes to logs, never to the response. */
healthRouter.get("/ready", async (_req, res) => {
  try {
    await query("SELECT 1");
    res.json({ status: "ready" });
  } catch (err) {
    logger.error({ err: (err as Error).message }, "readiness check failed");
    res.status(503).json({ status: "unavailable" });
  }
});
