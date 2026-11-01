import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";
import { AppError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";

export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json({ error: { code: "not_found", message: "Route not found" } });
};

// Postgres error classes worth mapping; everything else is a 500 with no detail leaked.
const PG_UNIQUE = "23505";
const PG_FK = "23503";
const PG_CHECK = "23514";
const PG_INVALID_TEXT = "22P02"; // e.g. malformed uuid

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (res.headersSent) return;
  const requestId = req.id;

  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: "validation_failed",
        message: "Request validation failed",
        details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      },
      requestId,
    });
    return;
  }
  if (err instanceof AppError) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message, ...(err.details !== undefined ? { details: err.details } : {}) },
      requestId,
    });
    return;
  }
  // body-parser errors (malformed JSON, payload too large, wrong charset…)
  const status: unknown = err?.status ?? err?.statusCode;
  if (typeof status === "number" && status >= 400 && status < 500 && err?.expose) {
    const code = status === 413 ? "payload_too_large" : "bad_request";
    res.status(status).json({ error: { code, message: status === 413 ? "Request body too large" : "Malformed request" }, requestId });
    return;
  }
  const pgCode: string | undefined = err?.code;
  if (pgCode === PG_INVALID_TEXT) {
    res.status(400).json({ error: { code: "bad_request", message: "Malformed identifier" }, requestId });
    return;
  }
  if (pgCode === PG_UNIQUE || pgCode === PG_FK || pgCode === PG_CHECK) {
    logger.warn({ requestId, pgCode, constraint: err?.constraint }, "constraint violation");
    res.status(409).json({ error: { code: "conflict", message: "The request conflicts with existing data" }, requestId });
    return;
  }

  logger.error({ requestId, err: { name: err?.name, message: err?.message, code: pgCode, stack: err?.stack } }, "unhandled error");
  res.status(500).json({ error: { code: "internal_error", message: "Something went wrong" }, requestId });
};
