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

/** Example payload used by Bazaar discovery and docs (ATM equity-style call). */
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

/** Agent-oriented JSON Schema for Bazaar / discovery. */
export const optionInputJsonSchema = {
  type: "object",
  title: "EuropeanOptionPriceRequest",
  description:
    "Inputs for Black-Scholes-Merton European option fair value. Use consistent units (e.g. USD/MWh for power, USD/bbl for oil). timeToExpiry in year-fractions (0.25 ≈ 3 months).",
  properties: {
    spot: {
      type: "number",
      description:
        "Underlying price S (> 0). Spot or forward-equivalent level for the option (equity price, commodity index, power forward mark, etc.).",
      exclusiveMinimum: 0,
      examples: [100, 45.5, 82.25],
    },
    strike: {
      type: "number",
      description: "Strike price K (> 0) in the same units as spot.",
      exclusiveMinimum: 0,
      examples: [100, 50],
    },
    timeToExpiry: {
      type: "number",
      description:
        "Time to expiry T in years (≥ 0). Examples: 1/12≈0.083 monthly, 0.25 quarterly, 1 annual.",
      minimum: 0,
      examples: [0.25, 1.0],
    },
    rate: {
      type: "number",
      description:
        "Continuously compounded risk-free rate r (e.g. 0.05 = 5%). Use discount-appropriate funding rate for the market.",
      examples: [0.03, 0.05],
    },
    volatility: {
      type: "number",
      description:
        "Annualized volatility σ as a decimal (> 0). Example: 0.2 = 20% vol. Not percent points.",
      exclusiveMinimum: 0,
      examples: [0.15, 0.2, 0.45],
    },
    optionType: {
      type: "string",
      enum: ["call", "put"],
      description: "European call or put.",
    },
    dividendYield: {
      type: "number",
      description:
        "Continuous dividend / convenience / yield q (≥ 0, default 0). For FX-style, map foreign rate; for commodities often convenience yield; equities dividend yield.",
      minimum: 0,
      examples: [0, 0.02],
    },
  },
  required: [
    "spot",
    "strike",
    "timeToExpiry",
    "rate",
    "volatility",
    "optionType",
  ],
  additionalProperties: false,
} as const;

export const optionOutputJsonSchema = {
  type: "object",
  title: "EuropeanOptionPriceResponse",
  description:
    "Fair value and analytic Greeks for hedging and risk. Vega/theta/rho are raw derivatives (per 1.0 vol, per year, per 1.0 rate) — not trader 1%/day scalings.",
  properties: {
    price: {
      type: "number",
      description: "Model option fair value in underlying currency units",
    },
    greeks: {
      type: "object",
      description: "Analytic Black-Scholes-Merton Greeks for hedge construction",
      properties: {
        delta: {
          type: "number",
          description: "∂V/∂S — underlying hedge ratio (shares / units)",
        },
        gamma: {
          type: "number",
          description: "∂²V/∂S² — convexity / delta re-hedge intensity",
        },
        vega: {
          type: "number",
          description: "∂V/∂σ per 1.0 absolute vol (not per 1%)",
        },
        theta: {
          type: "number",
          description: "∂V/∂T per year (not per calendar day)",
        },
        rho: {
          type: "number",
          description: "∂V/∂r per 1.0 absolute rate (not per 1%)",
        },
      },
      required: ["delta", "gamma", "vega", "theta", "rho"],
    },
    inputs: {
      type: "object",
      description: "Echo of validated request inputs",
    },
    model: {
      type: "string",
      description: "Pricing model identifier",
      const: "black-scholes-merton",
    },
    units: {
      type: "object",
      description: "Human/agent readable unit notes for price and Greeks",
    },
    requestId: { type: "string", description: "Correlation id for this call" },
    computedAt: {
      type: "string",
      description: "ISO-8601 UTC timestamp of computation",
    },
  },
  required: ["price", "greeks", "inputs", "model", "requestId", "computedAt"],
} as const;
