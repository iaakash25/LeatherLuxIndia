import { Router } from "express";
import { z } from "zod";
import { env } from "../config/env.js";
import { query } from "../db/pool.js";
import { logger } from "../lib/logger.js";
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

/** Same sample estimate the storefront shows today: metro-style first digits are faster. */
miscRouter.get("/delivery/estimate", (req, res) => {
  const { pincode } = z.object({ pincode: z.string().regex(/^[1-9]\d{5}$/, "Enter a valid 6-digit pincode") }).parse(req.query);
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
