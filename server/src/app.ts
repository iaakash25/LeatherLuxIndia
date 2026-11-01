import crypto from "node:crypto";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { originCheck } from "./middleware/csrf.js";
import { errorHandler, notFoundHandler } from "./middleware/errors.js";
import { globalLimiter } from "./middleware/rate-limit.js";
import { adminRouter } from "./routes/admin.js";
import { authRouter } from "./routes/auth.js";
import { brandingRouter } from "./routes/branding.js";
import { cartRouter } from "./routes/cart.js";
import { catalogRouter } from "./routes/catalog.js";
import { healthRouter, miscRouter } from "./routes/misc.js";
import { ordersRouter } from "./routes/orders.js";
import { visitsRouter } from "./routes/visits.js";
import { wishlistRouter } from "./routes/wishlist.js";

export function createApp() {
  const e = env();
  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", e.TRUST_PROXY);

  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const id = crypto.randomUUID();
        res.setHeader("X-Request-Id", id);
        return id;
      },
      autoLogging: { ignore: (req) => (req.url?.startsWith("/api/health") || req.url?.startsWith("/media/")) ?? false },
      customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info"),
      serializers: {
        // Method, path (no query string, which could carry PII) and status only.
        req: (req) => ({ id: req.id, method: req.method, url: String(req.url).split("?")[0], ip: req.remoteAddress }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
    }),
  );

  // JSON API: lock the browser down completely; nothing here should ever be rendered.
  app.use(
    helmet({
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      referrerPolicy: { policy: "no-referrer" },
      hsts: { maxAge: 63_072_000, includeSubDomains: true },
    }),
  );
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || e.corsOrigins.includes(origin)),
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
      allowedHeaders: ["Content-Type", "Idempotency-Key"],
      maxAge: 600,
    }),
  );
  // Product photos (made by `npm run products:import`). Their names contain a hash of the source photo, so a given URL never changes
  // and browsers may keep it for a year. This sits before the rate limiter and the no-store rule on purpose: a page of products is
  // dozens of images, and none of it is sensitive. Read-only, no directory listings, no dotfiles.
  app.use("/media", express.static(e.mediaDir, {
    index: false, dotfiles: "ignore", redirect: false, immutable: true, maxAge: "365d",
    setHeaders: (res) => { res.setHeader("Cross-Origin-Resource-Policy", "cross-origin"); },
  }), (_req, res) => { res.status(404).type("text/plain").send("Not found"); });

  // Authenticated responses must never be cached by browsers or proxies; catalogue routes opt back in.
  app.use((_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });

  app.use(globalLimiter());
  app.use(cookieParser());
  app.use(express.json({ limit: "20kb", strict: true }));
  app.use(originCheck);

  app.use("/api/health", healthRouter);
  app.use("/api/auth", authRouter);
  app.use("/api/cart", cartRouter);
  app.use("/api/wishlist", wishlistRouter);
  app.use("/api/orders", ordersRouter);
  app.use("/api/admin", adminRouter);
  app.use("/api/branding", brandingRouter);
  app.use("/api/visits", visitsRouter);
  app.use("/api", catalogRouter);
  app.use("/api", miscRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
