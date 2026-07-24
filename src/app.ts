import express, { type Express, type Request, type Response } from "express";
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
import { wellKnownRouter } from "./routes/wellKnown.js";
import { optionRouter } from "./routes/option.js";
import { volatilityRouter } from "./routes/volatility.js";
import { createFacilitatorClient } from "./x402/facilitator.js";
import { createResourceServer } from "./x402/resourceServer.js";
import { buildPaidRoutes } from "./x402/routeConfig.js";
import { buildWellKnownX402 } from "./discovery/catalog.js";

/**
 * Register free discovery routes on the Express app root.
 * Well-known paths are registered both via router and explicit app.get so
 * they always resolve at /.well-known/... regardless of mount quirks.
 */
function mountFreeDiscoveryRoutes(app: Express): void {
  // Explicit root registration (most reliable for /.well-known/*)
  const sendWellKnown = (_req: Request, res: Response): void => {
    res
      .status(200)
      .type("application/json")
      .setHeader("Cache-Control", "public, max-age=60")
      .json(buildWellKnownX402(config));
  };

  app.get("/.well-known/x402", sendWellKnown);
  app.get("/.well-known/x402.json", sendWellKnown);

  // Router mount (same handlers) — keeps routes centralized for tests/docs
  app.use(wellKnownRouter);
  app.use(healthRouter);
}

export function createApp(): Express {
  const app = express();

  applySecurity(app, config);
  app.use(requestIdMiddleware);
  app.use(requestLogMiddleware);
  app.use(express.json({ limit: "256kb" }));

  // Free discovery first — before payment middleware / paid handlers
  mountFreeDiscoveryRoutes(app);

  // Idempotency for paid handlers
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

  app.use(optionRouter);
  app.use(volatilityRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
