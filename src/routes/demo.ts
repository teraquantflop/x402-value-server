import { Router } from "express";
import rateLimit from "express-rate-limit";
import { config } from "../config.js";
import { priceWithGreeks } from "../services/blackScholes.js";
import { getRequestId } from "../middleware/security.js";

/**
 * Fixed ATM sample used for free discovery / Bazaar seeding.
 * Inputs are constant — abuse-resistant (no custom books).
 */
export const DEMO_OPTION_INPUTS = {
  spot: 100,
  strike: 100,
  timeToExpiry: 1,
  rate: 0.05,
  volatility: 0.2,
  optionType: "call" as const,
  dividendYield: 0,
};

export const demoRouter = Router();

function demoRateLimiter() {
  return rateLimit({
    windowMs: config.rateLimitWindowMs,
    max: config.freeDemoRateMax,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: "rate_limited",
      message: "Free demo rate limit exceeded; retry later or use paid endpoints",
    },
  });
}

function handleDemo(_req: import("express").Request, res: import("express").Response): void {
  const requestId = getRequestId(_req);
  const result = priceWithGreeks(DEMO_OPTION_INPUTS, requestId);
  res
    .status(200)
    .type("application/json")
    .setHeader("X-Demo", "true")
    .setHeader("Cache-Control", "public, max-age=60")
    .json({
      ...result,
      demo: true,
      note:
        "Fixed ATM sample via live Black-Scholes engine. For custom inputs use paid POST /v1/option/price (USDC x402).",
    });
}

if (config.freeDemoEnabled) {
  const limiter = demoRateLimiter();
  demoRouter.get("/v1/demo/option-price", limiter, handleDemo);
  demoRouter.post("/v1/demo/option-price", limiter, handleDemo);
}
