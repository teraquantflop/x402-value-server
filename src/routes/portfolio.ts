import { Router } from "express";
import {
  portfolioGreeksInputSchema,
  portfolioScenarioInputSchema,
} from "../schemas/portfolio.js";
import {
  aggregatePortfolio,
  runPortfolioScenarios,
} from "../services/portfolio.js";
import { getRequestId } from "../middleware/security.js";
import { HttpError } from "../middleware/errorHandler.js";

export const portfolioRouter = Router();

/**
 * POST /v1/portfolio/greeks
 * Protected by x402 paymentMiddleware (mounted in app.ts), unless SKIP_PAYMENT=1.
 */
portfolioRouter.post("/v1/portfolio/greeks", (req, res, next) => {
  const requestId = getRequestId(req);
  try {
    const parsed = portfolioGreeksInputSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(
        400,
        "validation_error",
        "Invalid portfolio greeks inputs",
        parsed.error.flatten(),
      );
    }

    const { rate, dividendYield, includeDollarGreeks, positions } = parsed.data;
    const snap = aggregatePortfolio(
      rate,
      dividendYield,
      positions,
      includeDollarGreeks,
    );

    res.status(200).json({
      net: {
        mtm: snap.mtm,
        greeks: snap.greeks,
        ...(snap.dollarGreeks ? { dollarGreeks: snap.dollarGreeks } : {}),
      },
      legs: snap.legs,
      positionCount: positions.length,
      requestId,
      computedAt: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /v1/portfolio/scenario
 * Protected by x402 paymentMiddleware (mounted in app.ts), unless SKIP_PAYMENT=1.
 */
portfolioRouter.post("/v1/portfolio/scenario", (req, res, next) => {
  const requestId = getRequestId(req);
  try {
    const parsed = portfolioScenarioInputSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(
        400,
        "validation_error",
        "Invalid portfolio scenario inputs",
        parsed.error.flatten(),
      );
    }

    const { rate, dividendYield, positions, scenarios } = parsed.data;
    const result = runPortfolioScenarios(
      rate,
      dividendYield,
      positions,
      scenarios,
    );

    res.status(200).json({
      base: result.base,
      scenarios: result.scenarios,
      positionCount: positions.length,
      scenarioCount: scenarios.length,
      requestId,
      computedAt: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});
