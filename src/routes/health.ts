import { Router } from "express";
import { config, facilitatorStatus } from "../config.js";
import { buildServiceCard, SERVICE_CATALOG } from "../discovery/catalog.js";
import {
  OPTION_EXAMPLE_INPUT,
  OPTION_EXAMPLE_OUTPUT,
} from "../schemas/option.js";
import {
  IMPLIED_VOL_EXAMPLE_INPUT,
  IMPLIED_VOL_EXAMPLE_OUTPUT,
} from "../schemas/impliedVol.js";
import {
  VOL_SURFACE_EXAMPLE_INPUT,
  VOL_SURFACE_EXAMPLE_OUTPUT,
} from "../schemas/volatility.js";
import {
  PORTFOLIO_GREEKS_EXAMPLE_INPUT,
  PORTFOLIO_SCENARIO_EXAMPLE_INPUT,
} from "../schemas/portfolio.js";
import {
  SURFACE_PRICE_EXAMPLE_INPUT,
  SURFACE_SCENARIO_EXAMPLE_INPUT,
} from "../schemas/surfacePricing.js";
import {
  aggregatePortfolio,
  runPortfolioScenarios,
} from "../services/portfolio.js";
import { priceFromSurface } from "../services/priceFromSurface.js";
import { scenarioFromSurface } from "../services/scenarioFromSurface.js";

export const healthRouter = Router();

healthRouter.get("/health", (_req, res) => {
  // Never expose payTo / wallet addresses on free health (wallets only in 402).
  res.status(200).json({
    status: "ok",
    service: SERVICE_CATALOG.serviceName,
    productName: SERVICE_CATALOG.productName,
    version: config.serviceVersion,
    networks: config.networks,
    networkIds: config.networkIds,
    facilitators: facilitatorStatus(config),
    prices: {
      optionPrice: config.priceDollarString,
      impliedVol: config.priceImpliedVolDollarString,
      volatilitySurface: config.priceVolSurfaceDollarString,
      portfolioGreeks: config.pricePortfolioGreeksDollarString,
      portfolioScenario: config.pricePortfolioScenarioDollarString,
      optionFromSurface: config.priceOptionFromSurfaceDollarString,
      scenarioFromSurface: config.priceScenarioFromSurfaceDollarString,
    },
    capabilities: SERVICE_CATALOG.capabilities,
    timestamp: new Date().toISOString(),
  });
});

healthRouter.get("/", (_req, res) => {
  const card = buildServiceCard(config);

  const greeksSnap = aggregatePortfolio(
    PORTFOLIO_GREEKS_EXAMPLE_INPUT.rate,
    PORTFOLIO_GREEKS_EXAMPLE_INPUT.dividendYield,
    PORTFOLIO_GREEKS_EXAMPLE_INPUT.positions,
    PORTFOLIO_GREEKS_EXAMPLE_INPUT.includeDollarGreeks,
  );
  const scenarioResult = runPortfolioScenarios(
    PORTFOLIO_SCENARIO_EXAMPLE_INPUT.rate,
    PORTFOLIO_SCENARIO_EXAMPLE_INPUT.dividendYield,
    PORTFOLIO_SCENARIO_EXAMPLE_INPUT.positions,
    PORTFOLIO_SCENARIO_EXAMPLE_INPUT.scenarios,
  );
  const priceFromSurf = priceFromSurface(
    SURFACE_PRICE_EXAMPLE_INPUT,
    "00000000-0000-4000-8000-000000000006",
    "2026-01-01T00:00:00.000Z",
  );
  const scenarioFromSurf = scenarioFromSurface(
    SURFACE_SCENARIO_EXAMPLE_INPUT,
    "00000000-0000-4000-8000-000000000007",
    "2026-01-01T00:00:00.000Z",
  );

  res.status(200).json({
    ...card,
    examples: {
      optionPrice: {
        request: OPTION_EXAMPLE_INPUT,
        response: OPTION_EXAMPLE_OUTPUT,
      },
      impliedVol: {
        request: IMPLIED_VOL_EXAMPLE_INPUT,
        response: IMPLIED_VOL_EXAMPLE_OUTPUT,
      },
      volatilitySurface: {
        request: VOL_SURFACE_EXAMPLE_INPUT,
        response: VOL_SURFACE_EXAMPLE_OUTPUT,
      },
      portfolioGreeks: {
        request: PORTFOLIO_GREEKS_EXAMPLE_INPUT,
        response: {
          net: {
            mtm: greeksSnap.mtm,
            greeks: greeksSnap.greeks,
            dollarGreeks: greeksSnap.dollarGreeks,
          },
          legs: greeksSnap.legs,
          positionCount: PORTFOLIO_GREEKS_EXAMPLE_INPUT.positions.length,
          requestId: "00000000-0000-4000-8000-000000000004",
          computedAt: "2026-01-01T00:00:00.000Z",
        },
      },
      portfolioScenario: {
        request: PORTFOLIO_SCENARIO_EXAMPLE_INPUT,
        response: {
          base: scenarioResult.base,
          scenarios: scenarioResult.scenarios,
          positionCount: PORTFOLIO_SCENARIO_EXAMPLE_INPUT.positions.length,
          scenarioCount: PORTFOLIO_SCENARIO_EXAMPLE_INPUT.scenarios.length,
          requestId: "00000000-0000-4000-8000-000000000005",
          computedAt: "2026-01-01T00:00:00.000Z",
        },
      },
      optionFromSurface: {
        request: SURFACE_PRICE_EXAMPLE_INPUT,
        response: priceFromSurf,
      },
      scenarioFromSurface: {
        request: SURFACE_SCENARIO_EXAMPLE_INPUT,
        response: scenarioFromSurf,
      },
    },
  });
});
