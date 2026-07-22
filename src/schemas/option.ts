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

export const optionInputSchema = z
  .object({
    spot: finitePositive.describe("Current underlying price S"),
    strike: finitePositive.describe("Strike price K"),
    timeToExpiry: finiteNonNegative.describe("Time to expiry in years T"),
    rate: finiteNumber.describe("Continuously compounded risk-free rate r"),
    volatility: finitePositive.describe("Annualized volatility σ (> 0)"),
    optionType: z.enum(["call", "put"]).describe("Option type"),
    dividendYield: finiteNonNegative
      .optional()
      .default(0)
      .describe("Continuous dividend yield q (default 0)"),
  })
  .strict();

export type OptionInputBody = z.infer<typeof optionInputSchema>;

/** Example payload used by Bazaar discovery and docs. */
export const OPTION_EXAMPLE_INPUT = {
  spot: 100,
  strike: 100,
  timeToExpiry: 1,
  rate: 0.05,
  volatility: 0.2,
  optionType: "call" as const,
  dividendYield: 0,
};

export const OPTION_EXAMPLE_OUTPUT = {
  price: 10.45057562,
  greeks: {
    delta: 0.63683059,
    gamma: 0.01876202,
    vega: 37.52403469,
    theta: -6.41402764,
    rho: 53.23248343,
  },
  inputs: OPTION_EXAMPLE_INPUT,
  model: "black-scholes-merton",
  units: {
    price: "option value in spot currency units",
    delta: "dV/dS (share equivalent)",
    gamma: "d²V/dS²",
    vega: "dV/dσ per 1.0 absolute volatility (not per 1%)",
    theta: "dV/dT per year (not per day)",
    rho: "dV/dr per 1.0 absolute rate (not per 1%)",
  },
  requestId: "00000000-0000-4000-8000-000000000001",
  computedAt: "2026-01-01T00:00:00.000Z",
};

/** JSON Schema fragments for Bazaar discovery (agent-readable). */
export const optionInputJsonSchema = {
  type: "object",
  properties: {
    spot: {
      type: "number",
      description: "Current underlying spot price S (> 0)",
      exclusiveMinimum: 0,
    },
    strike: {
      type: "number",
      description: "Option strike price K (> 0)",
      exclusiveMinimum: 0,
    },
    timeToExpiry: {
      type: "number",
      description: "Time to expiry in years T (>= 0)",
      minimum: 0,
    },
    rate: {
      type: "number",
      description: "Continuously compounded risk-free rate r (e.g. 0.05 = 5%)",
    },
    volatility: {
      type: "number",
      description: "Annualized volatility σ (> 0, e.g. 0.2 = 20%)",
      exclusiveMinimum: 0,
    },
    optionType: {
      type: "string",
      enum: ["call", "put"],
      description: "Option type: call or put",
    },
    dividendYield: {
      type: "number",
      description: "Continuous dividend yield q (optional, default 0)",
      minimum: 0,
    },
  },
  required: ["spot", "strike", "timeToExpiry", "rate", "volatility", "optionType"],
  additionalProperties: false,
} as const;

export const optionOutputJsonSchema = {
  type: "object",
  properties: {
    price: { type: "number", description: "Option fair value" },
    greeks: {
      type: "object",
      properties: {
        delta: { type: "number" },
        gamma: { type: "number" },
        vega: { type: "number", description: "Per 1.0 absolute vol" },
        theta: { type: "number", description: "Per year" },
        rho: { type: "number", description: "Per 1.0 absolute rate" },
      },
      required: ["delta", "gamma", "vega", "theta", "rho"],
    },
    inputs: { type: "object" },
    model: { type: "string" },
    units: { type: "object" },
    requestId: { type: "string" },
    computedAt: { type: "string", description: "ISO-8601 timestamp" },
  },
  required: ["price", "greeks", "inputs", "model", "requestId", "computedAt"],
} as const;
