/**
 * MCP façade over existing pricing services (additive to HTTP x402 routes).
 * One paid tool per HTTP twin; same services, same price env vars.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createPaymentWrapper } from "@x402/mcp";
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import type { x402ResourceServer } from "@x402/core/server";
import type { AppConfig } from "../types.js";
import { payToForNetwork } from "../config.js";
import { settlementNetworkIds } from "../x402/settlementNetworks.js";
import { priceOptionDispatch } from "../services/priceDispatch.js";
import { solveImpliedVol } from "../services/impliedVol.js";
import { buildVolatilitySurface } from "../services/volatilitySurface.js";
import { aggregatePortfolio, runPortfolioScenarios } from "../services/portfolio.js";
import { priceFromSurface } from "../services/priceFromSurface.js";
import { scenarioFromSurface } from "../services/scenarioFromSurface.js";
import { OPTION_EXAMPLE_INPUT } from "../schemas/option.js";
import { IMPLIED_VOL_EXAMPLE_INPUT } from "../schemas/impliedVol.js";
import { VOL_SURFACE_EXAMPLE_INPUT } from "../schemas/volatility.js";
import {
  PORTFOLIO_GREEKS_EXAMPLE_INPUT,
  PORTFOLIO_SCENARIO_EXAMPLE_INPUT,
} from "../schemas/portfolio.js";
import {
  SURFACE_PRICE_EXAMPLE_INPUT,
  SURFACE_SCENARIO_EXAMPLE_INPUT,
} from "../schemas/surfacePricing.js";
import {
  SURFACE_CONVENTION,
  SURFACE_INTERPOLATION,
  SURFACE_WING_RULE,
} from "../services/surfaceInterpolator.js";
import { SERVICE_CATALOG } from "../discovery/catalog.js";
import { randomUUID } from "node:crypto";

/** Canonical MCP tool names (7 paid + service_info). */
export const MCP_PAID_TOOL_NAMES = [
  "price_option",
  "implied_vol",
  "implied_vol_surface",
  "price_from_surface",
  "scenario_from_surface",
  "portfolio_greeks",
  "portfolio_scenario",
] as const;

export const MCP_ALL_TOOL_NAMES = [
  "service_info",
  ...MCP_PAID_TOOL_NAMES,
] as const;

const optionToolSchema = {
  spot: z
    .number()
    .positive()
    .describe(
      "Underlying S (>0). Equity spot or power/commodity forward mark for the option window.",
    ),
  strike: z.number().positive().describe("Strike K (>0)"),
  timeToExpiry: z
    .number()
    .nonnegative()
    .optional()
    .describe("Year-fraction to expiry T (xor expiration)"),
  rate: z.number().describe("Continuous risk-free rate r"),
  volatility: z.number().positive().describe("Annualized vol σ (>0)"),
  optionType: z.enum(["call", "put"]).describe("Call or put"),
  dividendYield: z
    .number()
    .nonnegative()
    .optional()
    .default(0)
    .describe("Continuous yield q (default 0)"),
  optionStyle: z
    .enum(["european", "american"])
    .optional()
    .default("european")
    .describe('Exercise style (default "european")'),
  forwardStart: z
    .string()
    .datetime({ offset: true })
    .optional()
    .describe("ISO-8601 start of vol/exercise window"),
  expiration: z
    .string()
    .datetime({ offset: true })
    .optional()
    .describe("ISO-8601 end of vol/exercise window"),
  treeSteps: z.number().int().min(50).max(500).optional(),
};

const impliedVolToolSchema = {
  underlying: z
    .number()
    .positive()
    .describe("Underlying S (>0); equity spot or forward mark"),
  strike: z.number().positive(),
  timeToExpiry: z.number().nonnegative().optional(),
  rate: z.number(),
  dividendYield: z.number().nonnegative().optional().default(0),
  optionType: z.enum(["call", "put"]),
  premium: z.number().nonnegative().describe("Market option premium"),
  optionStyle: z.enum(["european", "american"]).optional().default("european"),
  forwardStart: z.string().datetime({ offset: true }).optional(),
  expiration: z.string().datetime({ offset: true }).optional(),
  treeSteps: z.number().int().min(50).max(500).optional(),
};

const surfaceOptionSchema = z.object({
  underlying: z
    .number()
    .positive()
    .describe("Underlying for this row (may differ by maturity)"),
  strike: z.number().positive(),
  timeToExpiry: z.number().nonnegative().optional(),
  optionType: z.enum(["call", "put"]),
  premium: z.number().nonnegative().describe("Market premium for this quote"),
});

const surfaceToolSchema = {
  rate: z.number().describe("Shared continuous rate r"),
  dividendYield: z.number().nonnegative().optional().default(0),
  optionStyle: z.enum(["european", "american"]).optional().default("european"),
  forwardStart: z.string().datetime({ offset: true }).optional(),
  expiration: z.string().datetime({ offset: true }).optional(),
  treeSteps: z.number().int().min(50).max(500).optional(),
  options: z
    .array(surfaceOptionSchema)
    .min(1)
    .describe("Market quotes with per-row underlyings and unique premiums"),
};

const portfolioPositionSchema = z.object({
  underlying: z.number().positive(),
  strike: z.number().positive(),
  timeToExpiry: z.number().nonnegative(),
  optionType: z.enum(["call", "put"]),
  quantity: z
    .number()
    .refine((n) => n !== 0, "quantity must be non-zero")
    .describe("Signed quantity (positive=long, negative=short)"),
  volatility: z.number().positive(),
});

const portfolioGreeksToolSchema = {
  rate: z.number(),
  dividendYield: z.number().nonnegative().optional().default(0),
  includeDollarGreeks: z.boolean().optional().default(false),
  optionStyle: z.enum(["european", "american"]).optional().default("european"),
  positions: z.array(portfolioPositionSchema).min(1),
};

const scenarioShockSchema = z.object({
  name: z.string().max(64).optional(),
  spotShock: z.number().optional().default(0),
  volShock: z.number().optional().default(0),
  timeDecayDays: z.number().nonnegative().optional().default(0),
});

const portfolioScenarioToolSchema = {
  rate: z.number(),
  dividendYield: z.number().nonnegative().optional().default(0),
  optionStyle: z.enum(["european", "american"]).optional().default("european"),
  positions: z.array(portfolioPositionSchema).min(1),
  scenarios: z.array(scenarioShockSchema).min(1),
};

const surfacePointSchema = z.union([
  z
    .object({
      k: z.number().describe("Log-moneyness k = ln(K/F)"),
      timeToExpiry: z.number().nonnegative(),
      iv: z.number().positive(),
    })
    .strict(),
  z
    .object({
      strike: z.number().positive(),
      underlying: z.number().positive(),
      timeToExpiry: z.number().nonnegative(),
      iv: z.number().positive(),
    })
    .strict(),
]);

const surfaceLegSchema = z
  .object({
    underlying: z
      .number()
      .positive()
      .describe("Forward or spot-as-forward F"),
    strike: z.number().positive(),
    timeToExpiry: z.number().nonnegative(),
    optionType: z.enum(["call", "put"]),
    quantity: z.number().optional().default(1),
    id: z.string().max(64).optional(),
  })
  .strict();

const priceFromSurfaceToolSchema = {
  surfaceConvention: z
    .literal(SURFACE_CONVENTION)
    .describe("Only log_moneyness_forward in v1"),
  interpolation: z.literal(SURFACE_INTERPOLATION).optional(),
  wingRule: z.literal(SURFACE_WING_RULE).optional(),
  rate: z.number(),
  dividendYield: z.number().nonnegative().optional().default(0),
  optionStyle: z.enum(["european", "american"]).optional().default("european"),
  surface: z.array(surfacePointSchema).min(1),
  options: z.array(surfaceLegSchema).min(1),
};

const scenarioFromSurfaceToolSchema = {
  surfaceConvention: z.literal(SURFACE_CONVENTION),
  interpolation: z.literal(SURFACE_INTERPOLATION).optional(),
  wingRule: z.literal(SURFACE_WING_RULE).optional(),
  rate: z.number(),
  dividendYield: z.number().nonnegative().optional().default(0),
  optionStyle: z.enum(["european", "american"]).optional().default("european"),
  sticky: z
    .enum(["moneyness", "strike", "fixed_vol"])
    .optional()
    .default("moneyness"),
  surface: z.array(surfacePointSchema).min(1),
  positions: z.array(surfaceLegSchema).min(1),
  scenario: z
    .object({
      underlyingRel: z.number().optional(),
      underlyingAbs: z.number().optional(),
      rateBp: z.number().optional().default(0),
      timeDays: z.number().nonnegative().optional().default(0),
      volAbs: z.number().optional().default(0),
      volRel: z.number().optional().default(0),
      smileTwist: z.number().optional().default(0),
    })
    .strict(),
};

async function buildAccepts(
  resourceServer: x402ResourceServer,
  config: AppConfig,
  price: string,
) {
  const networks = settlementNetworkIds(config, config.cdpConfigured);
  const nested = await Promise.all(
    networks.map((network) =>
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

function jsonResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

type ZodShape = Record<string, z.ZodTypeAny>;

type PaidToolSpec = {
  name: string;
  description: string;
  schema: ZodShape;
  price: string;
  serviceName: string;
  tags: string[];
  resourceDescription: string;
  discoveryDescription: string;
  inputSchema: Record<string, unknown>;
  required: string[];
  example: Record<string, unknown>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (args: any) => Promise<unknown> | unknown;
};

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

  const base = config.publicBaseUrl.replace(/\/$/, "");

  server.tool(
    "service_info",
    "Free discovery: prices, networks, HTTP paths, MCP tools. Call first to learn how to use this derivatives desk. No USDC required.",
    {},
    async () => {
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
          optionFromSurface: config.priceOptionFromSurfaceDollarString,
          scenarioFromSurface: config.priceScenarioFromSurfaceDollarString,
          portfolioGreeks: config.pricePortfolioGreeksDollarString,
          portfolioScenario: config.pricePortfolioScenarioDollarString,
        },
        http: {
          price: "POST /v1/option/price",
          impliedVol: "POST /v1/option/implied-vol",
          surface: "POST /v1/volatility/surface",
          priceFromSurface: "POST /v1/option/price-from-surface",
          scenarioFromSurface: "POST /v1/option/scenario-from-surface",
          portfolioGreeks: "POST /v1/portfolio/greeks",
          portfolioScenario: "POST /v1/portfolio/scenario",
          freeDemo: config.freeDemoEnabled
            ? "GET|POST /v1/demo/option-price"
            : null,
        },
        mcpTools: [...MCP_ALL_TOOL_NAMES],
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
        notes: [
          "European BSM (default) or American CRR binomial; optional forwardStart/expiration window (ACT/365.25).",
          "Not a swing/multi-exercise engine. No local-vol PDE.",
          "European Greeks analytic; American Greeks finite-difference.",
        ],
      };
      return jsonResult(body);
    },
  );

  const paidTools: PaidToolSpec[] = [
    {
      name: "price_option",
      description: [
        "Price a European (BSM) or American (CRR) option and return Greeks.",
        "Optional forwardStart/expiration ISO-8601 window: vol accrues only in τ = years(effectiveStart, expiration), not calendar time from purchase.",
        "When to call: model inputs (spot/forward mark, strike, T or timestamps, r, σ, call/put, optionStyle).",
        "NOT for: swing/multi-exercise, barrier/local-vol PDE, or inverting premiums (use implied_vol).",
        `Payment: ${config.priceDollarString} USDC exact may be required.`,
        "Same engine as POST /v1/option/price.",
      ].join(" "),
      schema: optionToolSchema,
      price: config.priceDollarString,
      serviceName: "Option Price+Greeks",
      tags: ["options", "greeks", "usdc"],
      resourceDescription:
        "European BSM or American CRR fair value + Greeks for AI risk agents",
      discoveryDescription:
        "Price european/american option + Greeks (S,K,T or window,r,σ). USDC may be required.",
      inputSchema: {
        spot: { type: "number" },
        strike: { type: "number" },
        timeToExpiry: { type: "number" },
        rate: { type: "number" },
        volatility: { type: "number" },
        optionType: { type: "string", enum: ["call", "put"] },
        dividendYield: { type: "number" },
        optionStyle: { type: "string", enum: ["european", "american"] },
        forwardStart: { type: "string" },
        expiration: { type: "string" },
        treeSteps: { type: "integer" },
      },
      required: ["spot", "strike", "rate", "volatility", "optionType"],
      example: OPTION_EXAMPLE_INPUT,
      handler: (args) =>
        priceOptionDispatch(
          {
            spot: args.spot,
            strike: args.strike,
            timeToExpiry: args.timeToExpiry,
            rate: args.rate,
            volatility: args.volatility,
            optionType: args.optionType,
            dividendYield: args.dividendYield ?? 0,
            optionStyle: args.optionStyle,
            forwardStart: args.forwardStart,
            expiration: args.expiration,
            treeSteps: args.treeSteps,
          },
          { requestId: randomUUID() },
        ),
    },
    {
      name: "implied_vol",
      description: [
        "Solve implied volatility from a single market premium (European BSM or American CRR), then return σ̂ and Greeks.",
        "When to call: one quote (premium known); not a full book.",
        "Markets: equity or commodity/power forward mark as underlying.",
        "NOT for: multi-quote surfaces (use implied_vol_surface) or local-vol calibration.",
        `Payment: ${config.priceImpliedVolDollarString} USDC exact may be required.`,
        "Same engine as POST /v1/option/implied-vol.",
      ].join(" "),
      schema: impliedVolToolSchema,
      price: config.priceImpliedVolDollarString,
      serviceName: "Single IV Solver",
      tags: ["options", "implied-vol", "usdc"],
      resourceDescription: "Implied vol from one market premium + Greeks",
      discoveryDescription:
        "Solve σ̂ from one premium + Greeks. USDC may be required.",
      inputSchema: {
        underlying: { type: "number" },
        strike: { type: "number" },
        timeToExpiry: { type: "number" },
        rate: { type: "number" },
        dividendYield: { type: "number" },
        optionType: { type: "string", enum: ["call", "put"] },
        premium: { type: "number" },
      },
      required: ["underlying", "strike", "rate", "optionType", "premium"],
      example: IMPLIED_VOL_EXAMPLE_INPUT,
      handler: (args) =>
        solveImpliedVol(
          {
            underlying: args.underlying,
            strike: args.strike,
            timeToExpiry: args.timeToExpiry,
            rate: args.rate,
            dividendYield: args.dividendYield ?? 0,
            optionType: args.optionType,
            premium: args.premium,
            optionStyle: args.optionStyle,
            forwardStart: args.forwardStart,
            expiration: args.expiration,
            treeSteps: args.treeSteps,
          },
          randomUUID(),
        ),
    },
    {
      name: "implied_vol_surface",
      description: [
        "Build an implied-vol smile/term structure from a strip of market premiums (European or American).",
        "When to call: multi-strike multi-maturity premiums; optional shared forwardStart/expiration window.",
        "NOT for: single-premium IV (use implied_vol), scalar-σ pricing (use price_option), or local-vol PDE.",
        `Payment: ${config.priceVolSurfaceDollarString} USDC exact may be required.`,
        "Same engine as POST /v1/volatility/surface.",
      ].join(" "),
      schema: surfaceToolSchema,
      price: config.priceVolSurfaceDollarString,
      serviceName: "IV Surface Desk",
      tags: ["volatility", "iv-surface", "usdc"],
      resourceDescription:
        "IV surface from market premiums with multi-maturity underlyings",
      discoveryDescription:
        "Invert a premium book to IV grid + Greeks. USDC may be required.",
      inputSchema: {
        rate: { type: "number" },
        dividendYield: { type: "number" },
        optionStyle: { type: "string" },
        options: { type: "array" },
      },
      required: ["rate", "options"],
      example: VOL_SURFACE_EXAMPLE_INPUT,
      handler: (args) =>
        buildVolatilitySurface(
          {
            rate: args.rate,
            dividendYield: args.dividendYield ?? 0,
            optionStyle: args.optionStyle,
            forwardStart: args.forwardStart,
            expiration: args.expiration,
            treeSteps: args.treeSteps,
          },
          args.options,
          randomUUID(),
        ),
    },
    {
      name: "price_from_surface",
      description: [
        "Price options on a submitted IV surface (total-variance bilinear in log-moneyness k=ln(K/F); wingRule=flat_vol). Supports optionStyle european|american.",
        "When to call: you already have a smile/surface grid and need prices + Greeks at interpolated σ.",
        "NOT for: inventing Dupire/SABR/local vol; scalar σ (use price_option); inverting premiums (use implied_vol_surface).",
        `Payment: ${config.priceOptionFromSurfaceDollarString} USDC exact may be required.`,
        "Same engine as POST /v1/option/price-from-surface.",
      ].join(" "),
      schema: priceFromSurfaceToolSchema,
      price: config.priceOptionFromSurfaceDollarString,
      serviceName: "Price From Surface",
      tags: ["surface-price", "options", "usdc"],
      resourceDescription: "Price options on a submitted IV surface",
      discoveryDescription:
        "Price on submitted smile (TV bilinear). USDC may be required.",
      inputSchema: {
        surfaceConvention: { type: "string" },
        rate: { type: "number" },
        surface: { type: "array" },
        options: { type: "array" },
      },
      required: ["surfaceConvention", "rate", "surface", "options"],
      example: SURFACE_PRICE_EXAMPLE_INPUT,
      handler: (args) =>
        priceFromSurface(
          {
            surfaceConvention: args.surfaceConvention,
            rate: args.rate,
            dividendYield: args.dividendYield ?? 0,
            optionStyle: args.optionStyle,
            surface: args.surface,
            options: args.options,
          },
          randomUUID(),
        ),
    },
    {
      name: "scenario_from_surface",
      description: [
        "Book reval on an IV surface: base vs scenario with sticky moneyness|strike|fixed_vol and optional F/rate/time/vol/smileTwist shocks. Supports optionStyle.",
        "When to call: need MTM change on a smile under shocks.",
        "NOT for: scalar-σ portfolio scenarios (use portfolio_scenario); static pricing only (use price_from_surface).",
        `Payment: ${config.priceScenarioFromSurfaceDollarString} USDC exact may be required.`,
        "Same engine as POST /v1/option/scenario-from-surface.",
      ].join(" "),
      schema: scenarioFromSurfaceToolSchema,
      price: config.priceScenarioFromSurfaceDollarString,
      serviceName: "Surface Scenarios",
      tags: ["scenario", "surface-price", "usdc"],
      resourceDescription: "Sticky smile book reval + shocks",
      discoveryDescription:
        "Base vs scenario on submitted smile. USDC may be required.",
      inputSchema: {
        surfaceConvention: { type: "string" },
        rate: { type: "number" },
        surface: { type: "array" },
        positions: { type: "array" },
        scenario: { type: "object" },
      },
      required: [
        "surfaceConvention",
        "rate",
        "surface",
        "positions",
        "scenario",
      ],
      example: SURFACE_SCENARIO_EXAMPLE_INPUT,
      handler: (args) =>
        scenarioFromSurface(
          {
            surfaceConvention: args.surfaceConvention,
            rate: args.rate,
            dividendYield: args.dividendYield ?? 0,
            optionStyle: args.optionStyle,
            sticky: args.sticky ?? "moneyness",
            surface: args.surface,
            positions: args.positions,
            scenario: args.scenario,
          },
          randomUUID(),
        ),
    },
    {
      name: "portfolio_greeks",
      description: [
        "Net MTM + Greeks for a multi-leg book (signed quantity: +long / −short). optionStyle european|american. Optional dollar Greeks.",
        "When to call: multi-leg risk aggregation with per-leg scalar σ.",
        "NOT for: smile/surface books (use price_from_surface / scenario_from_surface).",
        `Payment: ${config.pricePortfolioGreeksDollarString} USDC exact may be required.`,
        "Same engine as POST /v1/portfolio/greeks.",
      ].join(" "),
      schema: portfolioGreeksToolSchema,
      price: config.pricePortfolioGreeksDollarString,
      serviceName: "Portfolio Net Greeks",
      tags: ["portfolio", "greeks", "usdc"],
      resourceDescription: "Net MTM + Greeks for multi-leg books",
      discoveryDescription:
        "Aggregate portfolio Greeks/MTM. USDC may be required.",
      inputSchema: {
        rate: { type: "number" },
        dividendYield: { type: "number" },
        includeDollarGreeks: { type: "boolean" },
        optionStyle: { type: "string" },
        positions: { type: "array" },
      },
      required: ["rate", "positions"],
      example: PORTFOLIO_GREEKS_EXAMPLE_INPUT,
      handler: (args) => {
        const snap = aggregatePortfolio(
          args.rate,
          args.dividendYield ?? 0,
          args.positions,
          args.includeDollarGreeks ?? false,
          args.optionStyle ?? "european",
        );
        return {
          net: {
            mtm: snap.mtm,
            greeks: snap.greeks,
            dollarGreeks: snap.dollarGreeks,
          },
          legs: snap.legs,
          positionCount: args.positions.length,
          optionStyle: args.optionStyle ?? "european",
          requestId: randomUUID(),
          computedAt: new Date().toISOString(),
        };
      },
    },
    {
      name: "portfolio_scenario",
      description: [
        "Reprice a multi-leg book under relative spot/vol shocks and calendar time decay (per-leg scalar σ). Supports optionStyle.",
        "When to call: what-if P&L on a scalar-σ book.",
        "NOT for: sticky smile scenarios (use scenario_from_surface).",
        `Payment: ${config.pricePortfolioScenarioDollarString} USDC exact may be required.`,
        "Same engine as POST /v1/portfolio/scenario.",
      ].join(" "),
      schema: portfolioScenarioToolSchema,
      price: config.pricePortfolioScenarioDollarString,
      serviceName: "Portfolio Scenarios",
      tags: ["portfolio", "scenario", "usdc"],
      resourceDescription: "Scenario reprice under spot/vol/time shocks",
      discoveryDescription:
        "Portfolio scenario P&L (scalar σ). USDC may be required.",
      inputSchema: {
        rate: { type: "number" },
        dividendYield: { type: "number" },
        positions: { type: "array" },
        scenarios: { type: "array" },
      },
      required: ["rate", "positions", "scenarios"],
      example: PORTFOLIO_SCENARIO_EXAMPLE_INPUT,
      handler: (args) => {
        const result = runPortfolioScenarios(
          args.rate,
          args.dividendYield ?? 0,
          args.positions,
          args.scenarios,
          args.optionStyle ?? "european",
        );
        return {
          base: result.base,
          scenarios: result.scenarios,
          positionCount: args.positions.length,
          scenarioCount: args.scenarios.length,
          optionStyle: args.optionStyle ?? "european",
          requestId: randomUUID(),
          computedAt: new Date().toISOString(),
        };
      },
    },
  ];

  if (config.skipPayment) {
    for (const tool of paidTools) {
      server.tool(
        tool.name,
        `${tool.description} SKIP_PAYMENT mode — no USDC required.`,
        tool.schema,
        async (args) => jsonResult(await tool.handler(args)),
      );
    }
    return server;
  }

  for (const tool of paidTools) {
    const accepts = await buildAccepts(resourceServer, config, tool.price);
    const wrapper = createPaymentWrapper(resourceServer, {
      accepts,
      resource: {
        description: tool.resourceDescription,
        mimeType: "application/json",
        serviceName: tool.serviceName,
        tags: tool.tags,
      },
      extensions: declareDiscoveryExtension({
        toolName: tool.name,
        description: tool.discoveryDescription,
        inputSchema: {
          properties: tool.inputSchema,
          required: tool.required,
        },
        example: tool.example,
      }),
    });

    server.tool(
      tool.name,
      tool.description,
      tool.schema,
      wrapper(async (args) => jsonResult(await tool.handler(args))),
    );
  }

  return server;
}
