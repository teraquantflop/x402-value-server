import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import type { AppConfig } from "../types.js";
import { payToForNetwork } from "../config.js";
import {
  optionPriceDiscovery,
  impliedVolDiscovery,
  volatilitySurfaceDiscovery,
  portfolioGreeksDiscovery,
  portfolioScenarioDiscovery,
} from "../discovery/catalog.js";
import {
  OPTION_EXAMPLE_INPUT,
  OPTION_EXAMPLE_OUTPUT,
  optionInputJsonSchema,
  optionOutputJsonSchema,
} from "../schemas/option.js";
import {
  IMPLIED_VOL_EXAMPLE_INPUT,
  IMPLIED_VOL_EXAMPLE_OUTPUT,
  impliedVolInputJsonSchema,
  impliedVolOutputJsonSchema,
} from "../schemas/impliedVol.js";
import {
  VOL_SURFACE_EXAMPLE_INPUT,
  VOL_SURFACE_EXAMPLE_OUTPUT,
  volatilitySurfaceInputJsonSchema,
  volatilitySurfaceOutputJsonSchema,
} from "../schemas/volatility.js";
import {
  PORTFOLIO_GREEKS_EXAMPLE_INPUT,
  PORTFOLIO_SCENARIO_EXAMPLE_INPUT,
  portfolioGreeksInputJsonSchema,
  portfolioGreeksOutputJsonSchema,
  portfolioScenarioInputJsonSchema,
  portfolioScenarioOutputJsonSchema,
} from "../schemas/portfolio.js";
import { aggregatePortfolio, runPortfolioScenarios } from "../services/portfolio.js";

function acceptsForPrice(config: AppConfig, price: string) {
  return config.networkIds.map((network) => ({
    scheme: "exact" as const,
    price,
    network,
    payTo: payToForNetwork(config, network),
  }));
}

/** Stable example responses for Bazaar discovery (computed from engines). */
function portfolioGreeksExampleOutput() {
  const input = PORTFOLIO_GREEKS_EXAMPLE_INPUT;
  const snap = aggregatePortfolio(
    input.rate,
    input.dividendYield,
    input.positions,
    input.includeDollarGreeks,
  );
  return {
    net: {
      mtm: snap.mtm,
      greeks: snap.greeks,
      dollarGreeks: snap.dollarGreeks,
    },
    legs: snap.legs,
    positionCount: input.positions.length,
    requestId: "00000000-0000-4000-8000-000000000004",
    computedAt: "2026-01-01T00:00:00.000Z",
  };
}

function portfolioScenarioExampleOutput() {
  const input = PORTFOLIO_SCENARIO_EXAMPLE_INPUT;
  const result = runPortfolioScenarios(
    input.rate,
    input.dividendYield,
    input.positions,
    input.scenarios,
  );
  return {
    base: result.base,
    scenarios: result.scenarios,
    positionCount: input.positions.length,
    scenarioCount: input.scenarios.length,
    requestId: "00000000-0000-4000-8000-000000000005",
    computedAt: "2026-01-01T00:00:00.000Z",
  };
}

/**
 * x402 paid-route configuration with full Bazaar discovery metadata.
 * Descriptions/tags come from the discovery catalog (agent-oriented).
 */
export function buildPaidRoutes(config: AppConfig) {
  const optionMeta = optionPriceDiscovery(config);
  const ivMeta = impliedVolDiscovery(config);
  const surfaceMeta = volatilitySurfaceDiscovery(config);
  const portfolioMeta = portfolioGreeksDiscovery(config);
  const scenarioMeta = portfolioScenarioDiscovery(config);

  const portfolioGreeksOut = portfolioGreeksExampleOutput();
  const portfolioScenarioOut = portfolioScenarioExampleOutput();

  return {
    "POST /v1/option/price": {
      accepts: acceptsForPrice(config, config.priceDollarString),
      description: optionMeta.description,
      mimeType: optionMeta.mimeType,
      serviceName: optionMeta.serviceName,
      tags: optionMeta.tags,
      extensions: {
        ...declareDiscoveryExtension({
          bodyType: "json",
          // Equity ATM primary example; power-style documented in schema description
          input: OPTION_EXAMPLE_INPUT,
          inputSchema: {
            properties: optionInputJsonSchema.properties as Record<
              string,
              unknown
            >,
            required: [...optionInputJsonSchema.required],
          },
          output: {
            example: OPTION_EXAMPLE_OUTPUT,
            schema: optionOutputJsonSchema as Record<string, unknown>,
          },
        }),
      },
    },

    "POST /v1/option/implied-vol": {
      accepts: acceptsForPrice(config, config.priceImpliedVolDollarString),
      description: ivMeta.description,
      mimeType: ivMeta.mimeType,
      serviceName: ivMeta.serviceName,
      tags: ivMeta.tags,
      extensions: {
        ...declareDiscoveryExtension({
          bodyType: "json",
          input: IMPLIED_VOL_EXAMPLE_INPUT,
          inputSchema: {
            properties: impliedVolInputJsonSchema.properties as Record<
              string,
              unknown
            >,
            required: [...impliedVolInputJsonSchema.required],
          },
          output: {
            example: IMPLIED_VOL_EXAMPLE_OUTPUT,
            schema: impliedVolOutputJsonSchema as Record<string, unknown>,
          },
        }),
      },
    },

    "POST /v1/volatility/surface": {
      accepts: acceptsForPrice(config, config.priceVolSurfaceDollarString),
      description: surfaceMeta.description,
      mimeType: surfaceMeta.mimeType,
      serviceName: surfaceMeta.serviceName,
      tags: surfaceMeta.tags,
      extensions: {
        ...declareDiscoveryExtension({
          bodyType: "json",
          input: VOL_SURFACE_EXAMPLE_INPUT,
          inputSchema: {
            properties: volatilitySurfaceInputJsonSchema.properties as Record<
              string,
              unknown
            >,
            required: [...volatilitySurfaceInputJsonSchema.required],
          },
          output: {
            example: VOL_SURFACE_EXAMPLE_OUTPUT,
            schema: volatilitySurfaceOutputJsonSchema as Record<
              string,
              unknown
            >,
          },
        }),
      },
    },

    "POST /v1/portfolio/greeks": {
      accepts: acceptsForPrice(config, config.pricePortfolioGreeksDollarString),
      description: portfolioMeta.description,
      mimeType: portfolioMeta.mimeType,
      serviceName: portfolioMeta.serviceName,
      tags: portfolioMeta.tags,
      extensions: {
        ...declareDiscoveryExtension({
          bodyType: "json",
          input: PORTFOLIO_GREEKS_EXAMPLE_INPUT,
          inputSchema: {
            properties: portfolioGreeksInputJsonSchema.properties as Record<
              string,
              unknown
            >,
            required: [...portfolioGreeksInputJsonSchema.required],
          },
          output: {
            example: portfolioGreeksOut,
            schema: portfolioGreeksOutputJsonSchema as Record<string, unknown>,
          },
        }),
      },
    },

    "POST /v1/portfolio/scenario": {
      accepts: acceptsForPrice(
        config,
        config.pricePortfolioScenarioDollarString,
      ),
      description: scenarioMeta.description,
      mimeType: scenarioMeta.mimeType,
      serviceName: scenarioMeta.serviceName,
      tags: scenarioMeta.tags,
      extensions: {
        ...declareDiscoveryExtension({
          bodyType: "json",
          input: PORTFOLIO_SCENARIO_EXAMPLE_INPUT,
          inputSchema: {
            properties: portfolioScenarioInputJsonSchema.properties as Record<
              string,
              unknown
            >,
            required: [...portfolioScenarioInputJsonSchema.required],
          },
          output: {
            example: portfolioScenarioOut,
            schema: portfolioScenarioOutputJsonSchema as Record<
              string,
              unknown
            >,
          },
        }),
      },
    },
  };
}
