/**
 * Free machine-readable capabilities matrix (GET /v1/capabilities).
 * No wallets / payTo. Networks and prices from live config.
 */
import type { AppConfig } from "../types.js";
import { facilitatorStatus } from "../config.js";
import { MCP_ALL_TOOL_NAMES } from "../mcp/server.js";
import { SERVICE_CATALOG } from "./catalog.js";
import { paidPostPaths, buildPaidRoutes } from "../x402/routeConfig.js";

export function buildCapabilities(config: AppConfig) {
  const base = config.publicBaseUrl.replace(/\/$/, "");
  const paidPaths = paidPostPaths(
    buildPaidRoutes(config, { cdpEnabled: config.cdpConfigured }),
  );

  return {
    service: SERVICE_CATALOG.productName,
    version: config.serviceVersion,
    protocol: "x402",
    scheme: "exact",
    asset: "USDC",
    whenToUse: SERVICE_CATALOG.whenToUse,
    whenNotToUse: SERVICE_CATALOG.whenNotToUse,
    models: [
      {
        id: "black-scholes-merton",
        style: "european",
        greeks: "analytic",
        requestFlag: "bsm",
      },
      {
        id: "black-76",
        style: "european",
        greeks: "analytic",
        requestFlag: "black76",
        note: "Futures/forward mark F; set model=black76 (forward preferred).",
      },
      {
        id: "binomial-crr-american",
        style: "american",
        greeks: "finite-difference",
        requestFlag: "bsm",
      },
    ],
    greeks: {
      conventionDefault: "raw",
      conventions: ["raw", "trading"],
      units: {
        raw: {
          delta: "dV/dS or dV/dF",
          gamma: "d²V/dS² or d²V/dF²",
          vega: "dV/dσ per 1.0 absolute volatility (not per 1%)",
          theta: "dV/dT per year (not per day)",
          rho: "dV/dr per 1.0 absolute rate (not per 1%)",
        },
        trading: {
          vega: "per 1% vol",
          theta: "per calendar day",
          rho: "per basis point",
        },
      },
      note: 'Request field greekConvention: "raw" (default) | "trading". Applies to BSM, Black-76, and American CRR greeks.',
    },
    limits: {
      maxSurfaceOptions: config.maxSurfaceOptions,
      maxSurfacePoints: config.maxSurfacePoints,
      maxSurfacePriceOptions: config.maxSurfacePriceOptions,
      maxPortfolioPositions: config.maxPortfolioPositions,
      maxScenarios: config.maxScenarios,
    },
    networks: config.networks,
    networkIds: config.networkIds,
    facilitators: facilitatorStatus(config),
    prices: {
      optionPrice: config.priceDollarString,
      impliedVol: config.priceImpliedVolDollarString,
      volatilitySurface: config.priceVolSurfaceDollarString,
      optionFromSurface: config.priceOptionFromSurfaceDollarString,
      scenarioFromSurface: config.priceScenarioFromSurfaceDollarString,
      portfolioGreeks: config.pricePortfolioGreeksDollarString,
      portfolioScenario: config.pricePortfolioScenarioDollarString,
    },
    paidPaths,
    mcp: config.mcpEnabled
      ? {
          path: config.mcpPath,
          url: `${base}${config.mcpPath}`,
          acceptRequired: "application/json, text/event-stream",
          tools: [...MCP_ALL_TOOL_NAMES],
        }
      : { enabled: false },
    jobTags: {
      mark: ["POST /v1/option/price", "POST /v1/option/price-from-surface"],
      hedge_greeks: ["POST /v1/option/price", "POST /v1/portfolio/greeks"],
      iv_calib: [
        "POST /v1/option/implied-vol",
        "POST /v1/volatility/surface",
      ],
      book_risk: ["POST /v1/portfolio/greeks"],
      scenario: [
        "POST /v1/portfolio/scenario",
        "POST /v1/option/scenario-from-surface",
      ],
    },
    links: {
      serviceCard: `${base}/`,
      health: `${base}/health`,
      openapi: `${base}/openapi.json`,
      llmsTxt: `${base}/llms.txt`,
      wellKnown: `${base}/.well-known/x402.json`,
      agentCard: `${base}/.well-known/agent-card.json`,
      freeDemo: config.freeDemoEnabled
        ? `${base}/v1/demo/option-price`
        : null,
    },
  };
}
