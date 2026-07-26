import { z } from "zod";
import { config } from "../config.js";

const finitePositive = z
  .number({ invalid_type_error: "must be a number" })
  .finite("must be finite")
  .positive("must be > 0");

const finiteNonNegative = z
  .number({ invalid_type_error: "must be a number" })
  .finite("must be finite")
  .nonnegative("must be >= 0");

const finiteNumber = z
  .number({ invalid_type_error: "must be a number" })
  .finite("must be finite");

const nonzeroQuantity = finiteNumber.refine((n) => n !== 0, {
  message: "quantity must be non-zero (positive=long, negative=short)",
});

export const portfolioPositionSchema = z
  .object({
    underlying: finitePositive,
    strike: finitePositive,
    timeToExpiry: finiteNonNegative,
    optionType: z.enum(["call", "put"]),
    quantity: nonzeroQuantity,
    volatility: finitePositive,
  })
  .strict();

export const portfolioGreeksInputSchema = z
  .object({
    rate: finiteNumber,
    dividendYield: finiteNonNegative.optional().default(0),
    includeDollarGreeks: z.boolean().optional().default(false),
    positions: z
      .array(portfolioPositionSchema)
      .min(1)
      .max(config.maxPortfolioPositions),
  })
  .strict();

export const scenarioShockSchema = z
  .object({
    name: z.string().max(64).optional(),
    spotShock: finiteNumber.optional().default(0),
    volShock: finiteNumber.optional().default(0),
    timeDecayDays: finiteNonNegative.optional().default(0),
  })
  .strict();

export const portfolioScenarioInputSchema = z
  .object({
    rate: finiteNumber,
    dividendYield: finiteNonNegative.optional().default(0),
    positions: z
      .array(portfolioPositionSchema)
      .min(1)
      .max(config.maxPortfolioPositions),
    scenarios: z
      .array(scenarioShockSchema)
      .min(1)
      .max(config.maxScenarios),
  })
  .strict();

export type PortfolioGreeksInput = z.infer<typeof portfolioGreeksInputSchema>;
export type PortfolioScenarioInput = z.infer<
  typeof portfolioScenarioInputSchema
>;

export const PORTFOLIO_GREEKS_EXAMPLE_INPUT = {
  rate: 0.05,
  dividendYield: 0,
  includeDollarGreeks: true,
  positions: [
    {
      underlying: 100,
      strike: 100,
      timeToExpiry: 1,
      optionType: "call" as const,
      quantity: 10,
      volatility: 0.2,
    },
    {
      underlying: 100,
      strike: 110,
      timeToExpiry: 1,
      optionType: "put" as const,
      quantity: -5,
      volatility: 0.22,
    },
  ],
};

export const PORTFOLIO_SCENARIO_EXAMPLE_INPUT = {
  rate: 0.05,
  dividendYield: 0,
  positions: PORTFOLIO_GREEKS_EXAMPLE_INPUT.positions,
  scenarios: [
    {
      name: "spot_down_10",
      spotShock: -0.1,
      volShock: 0,
      timeDecayDays: 0,
    },
    {
      name: "vol_up_20pct_rel",
      spotShock: 0,
      volShock: 0.2,
      timeDecayDays: 1,
    },
  ],
};

export const portfolioPositionJsonSchema = {
  type: "object",
  properties: {
    underlying: {
      type: "number",
      exclusiveMinimum: 0,
      description: "Underlying S for this leg",
    },
    strike: { type: "number", exclusiveMinimum: 0 },
    timeToExpiry: { type: "number", minimum: 0 },
    optionType: { type: "string", enum: ["call", "put"] },
    quantity: {
      type: "number",
      description: "Position size; >0 long, <0 short; must be non-zero",
    },
    volatility: {
      type: "number",
      exclusiveMinimum: 0,
      description: "Annualized vol σ for this leg",
    },
  },
  required: [
    "underlying",
    "strike",
    "timeToExpiry",
    "optionType",
    "quantity",
    "volatility",
  ],
  additionalProperties: false,
} as const;

export const portfolioGreeksInputJsonSchema = {
  type: "object",
  title: "PortfolioGreeksRequest",
  description:
    "Aggregate net Greeks and MTM for a multi-leg European option book.",
  properties: {
    rate: { type: "number" },
    dividendYield: { type: "number", minimum: 0 },
    includeDollarGreeks: {
      type: "boolean",
      description:
        "If true, include cash delta/gamma and per-point vega/theta/rho scalings",
    },
    positions: {
      type: "array",
      minItems: 1,
      maxItems: 100,
      items: portfolioPositionJsonSchema,
    },
  },
  required: ["rate", "positions"],
  additionalProperties: false,
} as const;

export const portfolioScenarioInputJsonSchema = {
  type: "object",
  title: "PortfolioScenarioRequest",
  description:
    "Reprice a portfolio under relative spot/vol shocks and calendar time decay.",
  properties: {
    rate: { type: "number" },
    dividendYield: { type: "number", minimum: 0 },
    positions: {
      type: "array",
      minItems: 1,
      items: portfolioPositionJsonSchema,
    },
    scenarios: {
      type: "array",
      minItems: 1,
      maxItems: 20,
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          spotShock: {
            type: "number",
            description: "Relative spot move; newS = S*(1+spotShock)",
          },
          volShock: {
            type: "number",
            description: "Relative vol move; newσ = σ*(1+volShock)",
          },
          timeDecayDays: {
            type: "number",
            minimum: 0,
            description: "Calendar days of time decay; T reduced by days/365",
          },
        },
        additionalProperties: false,
      },
    },
  },
  required: ["rate", "positions", "scenarios"],
  additionalProperties: false,
} as const;

export const portfolioGreeksOutputJsonSchema = {
  type: "object",
  properties: {
    net: { type: "object" },
    legs: { type: "array" },
    positionCount: { type: "integer" },
    requestId: { type: "string" },
    computedAt: { type: "string" },
  },
  required: ["net", "legs", "positionCount", "requestId", "computedAt"],
} as const;

export const portfolioScenarioOutputJsonSchema = {
  type: "object",
  properties: {
    base: { type: "object" },
    scenarios: { type: "array" },
    positionCount: { type: "integer" },
    scenarioCount: { type: "integer" },
    requestId: { type: "string" },
    computedAt: { type: "string" },
  },
  required: [
    "base",
    "scenarios",
    "positionCount",
    "scenarioCount",
    "requestId",
    "computedAt",
  ],
} as const;
