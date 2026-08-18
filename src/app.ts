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
import {
  freeTierMiddleware,
  skipPaymentIfFreeTier,
} from "./middleware/freeTier.js";
import {
  deferredJsonParser,
  rejectStashedJsonError,
} from "./middleware/deferredJson.js";
import { requestLogMiddleware } from "./middleware/requestLog.js";
import { healthRouter } from "./routes/health.js";
import { wellKnownRouter } from "./routes/wellKnown.js";
import { openapiRouter, sendOpenApi } from "./routes/openapi.js";
import { llmsTxtRouter, sendLlmsTxt } from "./routes/llmsTxt.js";
import { demoRouter } from "./routes/demo.js";
import { staticAssetsRouter } from "./routes/staticAssets.js";
import { optionRouter } from "./routes/option.js";
import { volatilityRouter } from "./routes/volatility.js";
import { impliedVolRouter } from "./routes/impliedVol.js";
import { portfolioRouter } from "./routes/portfolio.js";
import { surfacePricingRouter } from "./routes/surfacePricing.js";
import {
  createFacilitatorClient,
  createFacilitatorClients,
} from "./x402/facilitator.js";
import { createResourceServer } from "./x402/resourceServer.js";
import { buildPaidRoutes } from "./x402/routeConfig.js";
import { buildWellKnownX402 } from "./discovery/catalog.js";
import { mountMcpRoutes } from "./mcp/http.js";
import type { x402ResourceServer } from "@x402/core/server";

/**
 * Register free discovery routes on the Express app root.
 */
function mountFreeDiscoveryRoutes(app: Express): void {
  const sendWellKnown = (_req: Request, res: Response): void => {
    res
      .status(200)
      .type("application/json")
      .setHeader("Cache-Control", "public, max-age=60")
      .json(buildWellKnownX402(config));
  };

  app.get("/.well-known/x402", sendWellKnown);
  app.get("/.well-known/x402.json", sendWellKnown);
  app.get("/openapi.json", sendOpenApi);
  app.get("/llms.txt", sendLlmsTxt);

  app.use(wellKnownRouter);
  app.use(openapiRouter);
  app.use(llmsTxtRouter);
  app.use(healthRouter);
  app.use(staticAssetsRouter);

  if (config.freeDemoEnabled) {
    app.use(demoRouter);
  }
}

export function createApp(): Express {
  const app = express();

  applySecurity(app, config);
  app.use(requestIdMiddleware);
  app.use(requestLogMiddleware);
  // Parse JSON but defer SyntaxError until after the x402 payment gate
  // so unpaid paid-routes return 402 (not 400) on empty/malformed bodies.
  app.use(deferredJsonParser("256kb"));

  // Free discovery + free demo first
  mountFreeDiscoveryRoutes(app);

  // Optional first-N free on /v1/option/price (before payment gate)
  app.use(freeTierMiddleware(config));

  // Idempotency for paid handlers
  const idempotencyStore = new MemoryIdempotencyStore(config.idempotencyTtlMs);
  app.use(idempotencyMiddleware(idempotencyStore));

  let resourceServer: x402ResourceServer | null = null;

  if (config.skipPayment) {
    console.warn(
      "[warn] SKIP_PAYMENT=1 — x402 payment gate is DISABLED (local/debug only)",
    );
  } else {
    const facilitators = createFacilitatorClients(config);
    resourceServer = createResourceServer(facilitators, config);
    const paidRoutes = buildPaidRoutes(config);
    const payMw = paymentMiddleware(paidRoutes, resourceServer);
    // Payment first: unpaid → 402 before Zod / stashed JSON errors
    app.use(skipPaymentIfFreeTier(payMw));
  }

  // After payment (or free-tier / SKIP_PAYMENT): surface deferred JSON parse errors
  app.use(rejectStashedJsonError);

  // MCP façade (own payment via @x402/mcp; not in HTTP paid route map)
  if (config.mcpEnabled) {
    if (config.skipPayment) {
      // Lightweight PayAI client for MCP structure when payment gate is off
      const facilitator = createFacilitatorClient(config);
      resourceServer = createResourceServer(facilitator, config);
    }
    if (resourceServer) {
      mountMcpRoutes(app, config, resourceServer);
    }
  }

  // Paid handlers: Zod validation only runs after payment gate above
  app.use(optionRouter);
  app.use(volatilityRouter);
  app.use(impliedVolRouter);
  app.use(portfolioRouter);
  app.use(surfacePricingRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
