import express, { type Express } from "express";
import { paymentMiddleware } from "@x402/express";
import { config } from "./config.js";
import { applySecurity, requestIdMiddleware } from "./middleware/security.js";
import {
  errorHandler,
  notFoundHandler,
} from "./middleware/errorHandler.js";
import {
  MemoryIdempotencyStore,
  idempotencyMiddleware,
} from "./middleware/idempotency.js";
import { requestLogMiddleware } from "./middleware/requestLog.js";
import { healthRouter } from "./routes/health.js";
import { optionRouter } from "./routes/option.js";
import { volatilityRouter } from "./routes/volatility.js";
import { createFacilitatorClient } from "./x402/facilitator.js";
import { createResourceServer } from "./x402/resourceServer.js";
import { buildPaidRoutes } from "./x402/routeConfig.js";

export function createApp(): Express {
  const app = express();

  applySecurity(app, config);
  app.use(requestIdMiddleware);
  app.use(requestLogMiddleware);
  // Larger limit for multi-option surface payloads
  app.use(express.json({ limit: "256kb" }));

  // Free routes (no payment)
  app.use(healthRouter);

  // Idempotency for paid handlers (application-level response cache)
  const idempotencyStore = new MemoryIdempotencyStore(config.idempotencyTtlMs);
  app.use(idempotencyMiddleware(idempotencyStore));

  // x402 payment gate (optional skip for local debugging only)
  if (config.skipPayment) {
    console.warn(
      "[warn] SKIP_PAYMENT=1 — x402 payment gate is DISABLED (local/debug only)",
    );
  } else {
    const facilitator = createFacilitatorClient(config);
    const resourceServer = createResourceServer(facilitator, config);
    const paidRoutes = buildPaidRoutes(config);
    app.use(paymentMiddleware(paidRoutes, resourceServer));
  }

  // Paid business handlers (middleware settles before these run on success path)
  app.use(optionRouter);
  app.use(volatilityRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
