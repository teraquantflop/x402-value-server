/**
 * MCP façade over existing pricing services (additive to HTTP x402 routes).
 * Tools: price_option, implied_vol_surface, service_info (free).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createPaymentWrapper } from "@x402/mcp";
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import type { x402ResourceServer } from "@x402/core/server";
import type { AppConfig } from "../types.js";
import { payToForNetwork } from "../config.js";
import { priceWithGreeks } from "../services/blackScholes.js";
import { buildVolatilitySurface } from "../services/volatilitySurface.js";
import { OPTION_EXAMPLE_INPUT } from "../schemas/option.js";
import { VOL_SURFACE_EXAMPLE_INPUT } from "../schemas/volatility.js";
import { SERVICE_CATALOG } from "../discovery/catalog.js";
import { randomUUID } from "node:crypto";

const optionToolSchema = {
  spot: z
    .number()
    .positive()
    .describe(
      "Underlying S (>0). Equity spot or power/commodity forward mark for the option maturity.",
    ),
  strike: z.number().positive().describe("Strike K (>0)"),
  timeToExpiry: z.number().nonnegative().describe("Year-fraction to expiry T"),
  rate: z.number().describe("Continuous risk-free rate r"),
  volatility: z.number().positive().describe("Annualized vol σ (>0)"),
  optionType: z.enum(["call", "put"]).describe("European call or put"),
  dividendYield: z
    .number()
    .nonnegative()
    .optional()
    .default(0)
    .describe("Continuous yield q (default 0)"),
};

const surfaceOptionSchema = z.object({
  underlying: z
    .number()
    .positive()
    .describe("Underlying for this row (may differ by maturity)"),
  strike: z.number().positive(),
  timeToExpiry: z.number().nonnegative(),
  optionType: z.enum(["call", "put"]),
  premium: z.number().nonnegative().describe("Market premium"),
});

const surfaceToolSchema = {
  rate: z.number().describe("Shared continuous rate r"),
  dividendYield: z.number().nonnegative().optional().default(0),
  options: z
    .array(surfaceOptionSchema)
    .min(1)
    .describe("Market quotes with per-row underlyings"),
};

async function buildAccepts(
  resourceServer: x402ResourceServer,
  config: AppConfig,
  price: string,
) {
  const nested = await Promise.all(
    config.networkIds.map((network) =>
      resourceServer.buildPaymentRequirements({
        scheme: "exact",
        network,
        payTo: payToForNetwork(config, network),
        price,
      }),
    ),
  );
  return nested.flat();
}

/**
 * Create a fresh McpServer for one Streamable HTTP request (stateless).
 */
export async function createDerivativesMcpServer(
  config: AppConfig,
  resourceServer: x402ResourceServer,
): Promise<McpServer> {
  const server = new McpServer({
    name: SERVICE_CATALOG.serviceName,
    version: config.serviceVersion,
  });

  // Free tool — no payment wrapper
  server.tool(
    "service_info",
    "Free discovery: prices, networks, HTTP paths, free demo URL, MCP tools. Call first to learn how to use this derivatives desk.",
    {},
    async () => {
      const base = config.publicBaseUrl.replace(/\/$/, "");
      const body = {
        service: SERVICE_CATALOG.productName,
        version: config.serviceVersion,
        tagline: SERVICE_CATALOG.tagline,
        networks: config.networks,
        networkIds: config.networkIds,
        prices: {
          optionPrice: config.priceDollarString,
          impliedVol: config.priceImpliedVolDollarString,
          volatilitySurface: config.priceVolSurfaceDollarString,
          portfolioGreeks: config.pricePortfolioGreeksDollarString,
          portfolioScenario: config.pricePortfolioScenarioDollarString,
        },
        http: {
          price: "POST /v1/option/price",
          surface: "POST /v1/volatility/surface",
          freeDemo: config.freeDemoEnabled
            ? "GET|POST /v1/demo/option-price"
            : null,
        },
        mcpTools: ["price_option", "implied_vol_surface", "service_info"],
        links: {
          serviceCard: `${base}/`,
          openapi: `${base}/openapi.json`,
          swagger: `${base}/swagger.json`,
          llmsTxt: `${base}/llms.txt`,
          skillMd: `${base}/skill.md`,
          wellKnown: `${base}/.well-known/x402.json`,
          freeDemo: config.freeDemoEnabled
            ? `${base}/v1/demo/option-price`
            : null,
          mcp: `${base}${config.mcpPath}`,
        },
        payment:
          "Paid tools may require USDC exact on Solana and/or Base via x402. No API keys.",
      };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(body, null, 2) }],
      };
    },
  );

  if (config.skipPayment) {
    // Local debug: tools without payment
    server.tool(
      "price_option",
      "Price a European option (BSM) + full Greeks. SKIP_PAYMENT mode — no USDC required.",
      optionToolSchema,
      async (args) => {
        const result = priceWithGreeks(
          {
            spot: args.spot,
            strike: args.strike,
            timeToExpiry: args.timeToExpiry,
            rate: args.rate,
            volatility: args.volatility,
            optionType: args.optionType,
            dividendYield: args.dividendYield ?? 0,
          },
          randomUUID(),
        );
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(result, null, 2) },
          ],
        };
      },
    );

    server.tool(
      "implied_vol_surface",
      "Build an IV surface from market premiums (multi-maturity underlyings supported). SKIP_PAYMENT mode.",
      surfaceToolSchema,
      async (args) => {
        const result = buildVolatilitySurface(
          { rate: args.rate, dividendYield: args.dividendYield ?? 0 },
          args.options,
          randomUUID(),
        );
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(result, null, 2) },
          ],
        };
      },
    );

    return server;
  }

  const priceAccepts = await buildAccepts(
    resourceServer,
    config,
    config.priceDollarString,
  );
  const surfaceAccepts = await buildAccepts(
    resourceServer,
    config,
    config.priceVolSurfaceDollarString,
  );

  const paidPrice = createPaymentWrapper(resourceServer, {
    accepts: priceAccepts,
    resource: {
      description:
        "European BSM fair value + analytic Greeks for AI risk agents",
      mimeType: "application/json",
      serviceName: "BSM Price+Greeks",
      tags: ["options", "greeks", "usdc"],
    },
    extensions: declareDiscoveryExtension({
      toolName: "price_option",
      description:
        "Price European option + Greeks from model inputs (S,K,T,r,σ). USDC may be required.",
      inputSchema: {
        properties: {
          spot: { type: "number" },
          strike: { type: "number" },
          timeToExpiry: { type: "number" },
          rate: { type: "number" },
          volatility: { type: "number" },
          optionType: { type: "string", enum: ["call", "put"] },
          dividendYield: { type: "number" },
        },
        required: [
          "spot",
          "strike",
          "timeToExpiry",
          "rate",
          "volatility",
          "optionType",
        ],
      },
      example: OPTION_EXAMPLE_INPUT,
    }),
  });

  const paidSurface = createPaymentWrapper(resourceServer, {
    accepts: surfaceAccepts,
    resource: {
      description:
        "IV surface from market premiums with multi-maturity underlyings",
      mimeType: "application/json",
      serviceName: "IV Surface Desk",
      tags: ["volatility", "iv-surface", "usdc"],
    },
    extensions: declareDiscoveryExtension({
      toolName: "implied_vol_surface",
      description:
        "Invert a premium book to IV grid + Greeks. USDC may be required.",
      inputSchema: {
        properties: {
          rate: { type: "number" },
          dividendYield: { type: "number" },
          options: { type: "array" },
        },
        required: ["rate", "options"],
      },
      example: VOL_SURFACE_EXAMPLE_INPUT,
    }),
  });

  server.tool(
    "price_option",
    [
      "Price a European option with Black-Scholes-Merton and return full analytic Greeks.",
      "When to call: you already have model inputs (underlying or forward mark S, strike, T, r, σ, call/put).",
      "Prefer this over implied_vol_surface when you are not inverting market premiums.",
      `Payment: ${config.priceDollarString} USDC exact may be required (Solana and/or Base).`,
      "Returns: price, greeks (delta, gamma, vega, theta, rho), units, requestId.",
    ].join(" "),
    optionToolSchema,
    paidPrice(async (args) => {
      const result = priceWithGreeks(
        {
          spot: args.spot,
          strike: args.strike,
          timeToExpiry: args.timeToExpiry,
          rate: args.rate,
          volatility: args.volatility,
          optionType: args.optionType,
          dividendYield: args.dividendYield ?? 0,
        },
        randomUUID(),
      );
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(result, null, 2) },
        ],
      };
    }),
  );

  server.tool(
    "implied_vol_surface",
    [
      "Build an implied-volatility surface from a book of market premiums.",
      "When to call: multi-strike multi-maturity premiums (power/commodity forwards may use different underlying per maturity).",
      "Prefer price_option when σ is already known; prefer single HTTP /v1/option/implied-vol for one premium.",
      `Payment: ${config.priceVolSurfaceDollarString} USDC exact may be required.`,
      "Returns: surface grid, points with IV+Greeks, fit metrics, stats.",
    ].join(" "),
    surfaceToolSchema,
    paidSurface(async (args) => {
      const result = buildVolatilitySurface(
        { rate: args.rate, dividendYield: args.dividendYield ?? 0 },
        args.options,
        randomUUID(),
      );
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(result, null, 2) },
        ],
      };
    }),
  );

  return server;
}
