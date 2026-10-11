import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import type { AppConfig } from "../types.js";
import { payToForNetwork } from "../config.js";
import {
  optionPriceDiscovery,
  impliedVolDiscovery,
  volatilitySurfaceDiscovery,
  portfolioGreeksDiscovery,
  portfolioScenarioDiscovery,
  priceFromSurfaceDiscovery,
  scenarioFromSurfaceDiscovery,
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
import {
  SURFACE_PRICE_EXAMPLE_INPUT,
  SURFACE_SCENARIO_EXAMPLE_INPUT,
  priceFromSurfaceInputJsonSchema,
  priceFromSurfaceOutputJsonSchema,
  scenarioFromSurfaceInputJsonSchema,
  scenarioFromSurfaceOutputJsonSchema,
} from "../schemas/surfacePricing.js";
import { priceFromSurface } from "../services/priceFromSurface.js";
import { scenarioFromSurface } from "../services/scenarioFromSurface.js";

import { settlementNetworkIds } from "./settlementNetworks.js";

/** Stock HTTP-body bazaar: info.input envelope + schema.properties.input.properties.body. */
function bodyDiscovery(opts: {
  input: Record<string, unknown>;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: readonly string[] | string[];
    [key: string]: unknown;
  };
  outputExample: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
}) {
  // method is omitted at declare time; stock enrichDeclaration injects POST.
  return declareDiscoveryExtension({
    bodyType: "json",
    input: opts.input,
    inputSchema: {
      type: "object",
      properties: opts.inputSchema.properties as Record<string, unknown>,
      required: opts.inputSchema.required
        ? [...opts.inputSchema.required]
        : undefined,
      ...(opts.inputSchema.additionalProperties !== undefined
        ? { additionalProperties: opts.inputSchema.additionalProperties }
        : {}),
      ...(typeof opts.inputSchema.title === "string"
        ? { title: opts.inputSchema.title }
        : {}),
      ...(typeof opts.inputSchema.description === "string"
        ? { description: opts.inputSchema.description }
        : {}),
    },
    output: {
      example: opts.outputExample,
      schema: opts.outputSchema,
    },
  });
}

export type BuildPaidRoutesOptions = {
  /** Base mainnet accepts only when CDP is enabled (never against PayAI). */
  cdpEnabled: boolean;
};

function acceptsForPrice(
  config: AppConfig,
  price: string,
  cdpEnabled: boolean,
) {
  return settlementNetworkIds(config, cdpEnabled).map((network) => ({
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
function priceFromSurfaceExampleOutput() {
  return priceFromSurface(
    SURFACE_PRICE_EXAMPLE_INPUT,
    "00000000-0000-4000-8000-000000000006",
    "2026-01-01T00:00:00.000Z",
  );
}

function scenarioFromSurfaceExampleOutput() {
  return scenarioFromSurface(
    {
      ...SURFACE_SCENARIO_EXAMPLE_INPUT,
      positions: SURFACE_SCENARIO_EXAMPLE_INPUT.positions,
    },
    "00000000-0000-4000-8000-000000000007",
    "2026-01-01T00:00:00.000Z",
  );
}

export function buildPaidRoutes(
  config: AppConfig,
  opts: BuildPaidRoutesOptions = { cdpEnabled: false },
) {
  const optionMeta = optionPriceDiscovery(config);
  const ivMeta = impliedVolDiscovery(config);
  const surfaceMeta = volatilitySurfaceDiscovery(config);
  const portfolioMeta = portfolioGreeksDiscovery(config);
  const scenarioMeta = portfolioScenarioDiscovery(config);
  const priceSurfMeta = priceFromSurfaceDiscovery(config);
  const scenSurfMeta = scenarioFromSurfaceDiscovery(config);

  const portfolioGreeksOut = portfolioGreeksExampleOutput();
  const portfolioScenarioOut = portfolioScenarioExampleOutput();
  const priceFromSurfOut = priceFromSurfaceExampleOutput();
  const scenarioFromSurfOut = scenarioFromSurfaceExampleOutput();
  const cdpEnabled = opts.cdpEnabled;

  return {
    "POST /v1/option/price": {
      accepts: acceptsForPrice(config, config.priceDollarString, cdpEnabled),
      description: optionMeta.description,
      mimeType: optionMeta.mimeType,
      serviceName: optionMeta.serviceName,
      tags: optionMeta.tags,
      iconUrl: optionMeta.iconUrl,
      extensions: {
        ...bodyDiscovery({
          input: OPTION_EXAMPLE_INPUT,
          inputSchema: optionInputJsonSchema,
          outputExample: OPTION_EXAMPLE_OUTPUT,
          outputSchema: optionOutputJsonSchema as Record<string, unknown>,
        }),
      },
    },

    "POST /v1/option/implied-vol": {
      accepts: acceptsForPrice(config, config.priceImpliedVolDollarString, cdpEnabled),
      description: ivMeta.description,
      mimeType: ivMeta.mimeType,
      serviceName: ivMeta.serviceName,
      tags: ivMeta.tags,
      iconUrl: ivMeta.iconUrl,
      extensions: {
        ...bodyDiscovery({
          input: IMPLIED_VOL_EXAMPLE_INPUT,
          inputSchema: impliedVolInputJsonSchema,
          outputExample: IMPLIED_VOL_EXAMPLE_OUTPUT,
          outputSchema: impliedVolOutputJsonSchema as Record<string, unknown>,
        }),
      },
    },

    "POST /v1/volatility/surface": {
      accepts: acceptsForPrice(config, config.priceVolSurfaceDollarString, cdpEnabled),
      description: surfaceMeta.description,
      mimeType: surfaceMeta.mimeType,
      serviceName: surfaceMeta.serviceName,
      tags: surfaceMeta.tags,
      iconUrl: surfaceMeta.iconUrl,
      extensions: {
        ...bodyDiscovery({
          input: VOL_SURFACE_EXAMPLE_INPUT,
          inputSchema: volatilitySurfaceInputJsonSchema,
          outputExample: VOL_SURFACE_EXAMPLE_OUTPUT,
          outputSchema: volatilitySurfaceOutputJsonSchema as Record<
            string,
            unknown
          >,
        }),
      },
    },

    "POST /v1/portfolio/greeks": {
      accepts: acceptsForPrice(config, config.pricePortfolioGreeksDollarString, cdpEnabled),
      description: portfolioMeta.description,
      mimeType: portfolioMeta.mimeType,
      serviceName: portfolioMeta.serviceName,
      tags: portfolioMeta.tags,
      iconUrl: portfolioMeta.iconUrl,
      extensions: {
        ...bodyDiscovery({
          input: PORTFOLIO_GREEKS_EXAMPLE_INPUT,
          inputSchema: portfolioGreeksInputJsonSchema,
          outputExample: portfolioGreeksOut,
          outputSchema: portfolioGreeksOutputJsonSchema as Record<
            string,
            unknown
          >,
        }),
      },
    },

    "POST /v1/portfolio/scenario": {
      accepts: acceptsForPrice(config, config.pricePortfolioScenarioDollarString, cdpEnabled),
      description: scenarioMeta.description,
      mimeType: scenarioMeta.mimeType,
      serviceName: scenarioMeta.serviceName,
      tags: scenarioMeta.tags,
      iconUrl: scenarioMeta.iconUrl,
      extensions: {
        ...bodyDiscovery({
          input: PORTFOLIO_SCENARIO_EXAMPLE_INPUT,
          inputSchema: portfolioScenarioInputJsonSchema,
          outputExample: portfolioScenarioOut,
          outputSchema: portfolioScenarioOutputJsonSchema as Record<
            string,
            unknown
          >,
        }),
      },
    },

    "POST /v1/option/price-from-surface": {
      accepts: acceptsForPrice(config, config.priceOptionFromSurfaceDollarString, cdpEnabled),
      description: priceSurfMeta.description,
      mimeType: priceSurfMeta.mimeType,
      serviceName: priceSurfMeta.serviceName,
      tags: priceSurfMeta.tags,
      iconUrl: priceSurfMeta.iconUrl,
      extensions: {
        ...bodyDiscovery({
          input: SURFACE_PRICE_EXAMPLE_INPUT,
          inputSchema: priceFromSurfaceInputJsonSchema,
          outputExample: priceFromSurfOut,
          outputSchema: priceFromSurfaceOutputJsonSchema as Record<
            string,
            unknown
          >,
        }),
      },
    },

    "POST /v1/option/scenario-from-surface": {
      accepts: acceptsForPrice(config, config.priceScenarioFromSurfaceDollarString, cdpEnabled),
      description: scenSurfMeta.description,
      mimeType: scenSurfMeta.mimeType,
      serviceName: scenSurfMeta.serviceName,
      tags: scenSurfMeta.tags,
      iconUrl: scenSurfMeta.iconUrl,
      extensions: {
        ...bodyDiscovery({
          input: SURFACE_SCENARIO_EXAMPLE_INPUT,
          inputSchema: scenarioFromSurfaceInputJsonSchema,
          outputExample: scenarioFromSurfOut,
          outputSchema: scenarioFromSurfaceOutputJsonSchema as Record<
            string,
            unknown
          >,
        }),
      },
    },
  };
}

export type PaidRoutesMap = ReturnType<typeof buildPaidRoutes>;

/**
 * Clone each POST paid route to HEAD with the same accepts[].
 * Uptime monitors send HEAD; @x402/express matches method+path, so HEAD must
 * be registered or Express returns 404. Discovery catalogs stay POST-only.
 * Strip bazaar extensions on HEAD clones (POST body schemas are invalid for HEAD).
 */
export function withHeadChallenges<T extends Record<string, unknown>>(
  routes: T,
): T & Record<string, T[keyof T]> {
  const out: Record<string, unknown> = { ...routes };
  for (const key of Object.keys(routes)) {
    if (!key.startsWith("POST ")) continue;
    const path = key.slice("POST ".length);
    const headKey = `HEAD ${path}`;
    if (out[headKey] !== undefined) continue;
    const postCfg = routes[key as keyof T] as Record<string, unknown>;
    const { extensions: _ext, ...rest } = postCfg;
    out[headKey] = {
      ...rest,
      description:
        typeof rest.description === "string"
          ? `HEAD challenge for ${path} (POST to compute)`
          : rest.description,
    };
  }
  return out as T & Record<string, T[keyof T]>;
}

/** Absolute paths of paid POST resources (no method prefix). */
export function paidPostPaths(
  routes: Record<string, unknown> = {},
): string[] {
  return Object.keys(routes)
    .filter((k) => k.startsWith("POST "))
    .map((k) => k.slice("POST ".length))
    .sort();
}
