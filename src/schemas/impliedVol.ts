import { z } from "zod";

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

export const impliedVolInputSchema = z
  .object({
    underlying: finitePositive.describe("Underlying price S"),
    strike: finitePositive.describe("Strike K"),
    timeToExpiry: finiteNonNegative.describe("Year-fraction to expiry T"),
    rate: finiteNumber.describe("Continuous risk-free rate r"),
    dividendYield: finiteNonNegative
      .optional()
      .default(0)
      .describe("Continuous yield q (default 0)"),
    optionType: z.enum(["call", "put"]),
    premium: finiteNonNegative.describe("Market option premium"),
  })
  .strict();

export type ImpliedVolInput = z.infer<typeof impliedVolInputSchema>;

export const IMPLIED_VOL_EXAMPLE_INPUT = {
  underlying: 100,
  strike: 100,
  timeToExpiry: 1,
  rate: 0.05,
  dividendYield: 0,
  optionType: "call" as const,
  premium: 10.45057562,
};

export const IMPLIED_VOL_EXAMPLE_OUTPUT = {
  impliedVol: 0.2,
  greeks: {
    delta: 0.63683059,
    gamma: 0.01876202,
    vega: 37.52403469,
    theta: -6.41402764,
    rho: 53.23248343,
  },
  modelPrice: 10.45057562,
  priceError: 0,
  iterations: 12,
  converged: true,
  inputs: IMPLIED_VOL_EXAMPLE_INPUT,
  requestId: "00000000-0000-4000-8000-000000000003",
  computedAt: "2026-01-01T00:00:00.000Z",
};

export const impliedVolInputJsonSchema = {
  type: "object",
  title: "ImpliedVolRequest",
  description:
    "Solve Black-Scholes implied volatility from a single market premium.",
  properties: {
    underlying: {
      type: "number",
      exclusiveMinimum: 0,
      description: "Underlying price S (> 0)",
    },
    strike: {
      type: "number",
      exclusiveMinimum: 0,
      description: "Strike K (> 0)",
    },
    timeToExpiry: {
      type: "number",
      minimum: 0,
      description: "Time to expiry in years",
    },
    rate: { type: "number", description: "Continuous risk-free rate r" },
    dividendYield: {
      type: "number",
      minimum: 0,
      description: "Continuous yield q (default 0)",
    },
    optionType: { type: "string", enum: ["call", "put"] },
    premium: {
      type: "number",
      minimum: 0,
      description: "Observed market premium",
    },
  },
  required: [
    "underlying",
    "strike",
    "timeToExpiry",
    "rate",
    "optionType",
    "premium",
  ],
  additionalProperties: false,
} as const;

export const impliedVolOutputJsonSchema = {
  type: "object",
  title: "ImpliedVolResponse",
  properties: {
    impliedVol: { type: "number" },
    greeks: { type: "object" },
    modelPrice: { type: "number" },
    priceError: { type: "number" },
    iterations: { type: "integer" },
    converged: { type: "boolean" },
    inputs: { type: "object" },
    requestId: { type: "string" },
    computedAt: { type: "string" },
  },
  required: [
    "impliedVol",
    "greeks",
    "modelPrice",
    "priceError",
    "iterations",
    "converged",
    "requestId",
    "computedAt",
  ],
} as const;
