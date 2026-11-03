import { Router } from "express";
import { env } from "../config/env.js";

/**
 * TEMPORARY (remove once the visitor-address problem on Vercel is understood). Shows how the API sees the caller's own request: the address
 * Express worked out, the connection's address, the forwarding headers, and the proxy setting. It answers only about the caller's own request
 * and holds no secrets, no other visitor's data and nothing from the database.
 */
export const diagIpRouter = Router();

const HEADERS = ["x-forwarded-for", "x-real-ip", "x-vercel-forwarded-for", "forwarded", "x-forwarded-proto", "x-forwarded-host", "via"];

diagIpRouter.get("/", (req, res) => {
  const seen: Record<string, string | string[] | undefined> = {};
  for (const h of HEADERS) seen[h] = req.headers[h];
  res.json({
    ip: req.ip,
    ips: req.ips,
    socketAddress: req.socket.remoteAddress ?? null,
    headers: seen,
    trustProxy: { applied: req.app.get("trust proxy"), parsed: env().TRUST_PROXY, rawEnv: process.env["TRUST_PROXY"] ?? null },
    platform: {
      VERCEL: process.env["VERCEL"] ?? null,
      VERCEL_ENV: process.env["VERCEL_ENV"] ?? null,
      VERCEL_REGION: process.env["VERCEL_REGION"] ?? null,
      lambda: Boolean(process.env["AWS_LAMBDA_FUNCTION_NAME"] || process.env["LAMBDA_TASK_ROOT"]),
    },
  });
});
