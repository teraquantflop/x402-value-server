import cors from "cors";
import type { Express, RequestHandler } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import type { AppConfig } from "../types.js";

export function applySecurity(app: Express, config: AppConfig): void {
  if (config.trustProxy) {
    app.set("trust proxy", 1);
  }

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: "cross-origin" },
    }),
  );

  app.use(
    cors({
      origin: config.corsOrigin === "*" ? true : config.corsOrigin,
      methods: ["GET", "POST", "OPTIONS"],
      allowedHeaders: [
        "Content-Type",
        "Idempotency-Key",
        "PAYMENT-SIGNATURE",
        "X-PAYMENT",
        "X-PAYMENT-RESPONSE",
        "PAYMENT-RESPONSE",
      ],
      exposedHeaders: [
        "PAYMENT-REQUIRED",
        "PAYMENT-RESPONSE",
        "X-PAYMENT-RESPONSE",
        "Idempotent-Replay",
        "X-Request-Id",
      ],
    }),
  );

  app.use(
    rateLimit({
      windowMs: config.rateLimitWindowMs,
      max: config.rateLimitMax,
      standardHeaders: true,
      legacyHeaders: false,
      message: {
        error: "rate_limit_exceeded",
        message: "Too many requests. Please retry later.",
      },
    }),
  );
}

export type RequestWithId = {
  requestId?: string;
  header(name: string): string | undefined;
};

/**
 * Attach a request id for log correlation with Railway Network Flow.
 * Prefer x-railway-request-id (Flow.requestId), then x-request-id, else UUID.
 * Always echo as X-Request-Id so app logs join Flow on requestId.
 */
export const requestIdMiddleware: RequestHandler = (req, res, next) => {
  const railway = req.header("x-railway-request-id")?.trim();
  const incoming = req.header("x-request-id")?.trim();
  const id =
    railway && railway.length > 0 && railway.length <= 128
      ? railway
      : incoming && incoming.length > 0 && incoming.length <= 128
        ? incoming
        : crypto.randomUUID();
  res.setHeader("X-Request-Id", id);
  (req as unknown as RequestWithId).requestId = id;
  next();
};

export function getRequestId(req: RequestWithId): string {
  return (
    req.requestId ??
    req.header("x-railway-request-id") ??
    req.header("x-request-id") ??
    crypto.randomUUID()
  );
}
