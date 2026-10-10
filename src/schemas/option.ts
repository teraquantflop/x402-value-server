import { z } from "zod";
import {
  isoDateTimeSchema,
  optionStyleSchema,
  optionalTimeToExpirySchema,
  refineOptionTimeline,
  treeStepsSchema,
} from "./optionCommon.js";

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
    spot: finitePositive
      .optional()
      .describe("Underlying spot S (required for model=bsm; optional for black76 if forward set)"),
    forward: finitePositive
      .optional()
      .describe("Forward mark F for model=black76 (preferred); if omitted, spot is used as F"),
    strike: finitePositive.describe("Strike price K"),
    timeToExpiry: optionalTimeToExpirySchema,
    rate: finiteNumber.describe("Continuously compounded risk-free rate r"),
    volatility: finitePositive.describe("Annualized volatility σ (> 0)"),
    optionType: z.enum(["call", "put"]).describe("Option type"),
    dividendYield: finiteNonNegative
      .optional()
      .default(0)
      .describe("Continuous dividend yield q (default 0; must be 0 for black76)"),
    optionStyle: optionStyleSchema,
    model: z
      .enum(["bsm", "black76"])
      .default("bsm")
      .describe('Pricing model: "bsm" (default European BSM on spot) or "black76" (forward/futures)'),
    greekConvention: z
      .enum(["raw", "trading"])
      .default("raw")
      .describe(
        'Greek units: "raw" (vega/1.0 vol, theta/year, rho/1.0 rate) or "trading" (vega/1%, theta/day, rho/bp)',
      ),
    forwardStart: isoDateTimeSchema
      .optional()
      .describe(
        "ISO-8601 start of exercise/vol window (optional; default now). Vol accrues only after effectiveStart.",
      ),
    expiration: isoDateTimeSchema
      .optional()
      .describe(
        "ISO-8601 end of exercise/vol window. Mutually exclusive with timeToExpiry.",
      ),
    treeSteps: treeStepsSchema.optional(),
  })
  .strict()
  .superRefine(refineOptionTimeline)
  .superRefine((data, ctx) => {
    const model = data.model ?? "bsm";
    if (model === "bsm") {
      if (data.spot === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "spot is required when model is bsm",
          path: ["spot"],
        });
      }
    } else {
      // black76
      if (data.spot === undefined && data.forward === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "forward or spot is required when model is black76",
          path: ["forward"],
        });
      }
      if ((data.dividendYield ?? 0) !== 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "dividendYield must be 0 (or omitted) for model=black76",
          path: ["dividendYield"],
        });
      }
      if ((data.optionStyle ?? "european") === "american") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "model=black76 supports european only (use bsm + american for CRR)",
          path: ["optionStyle"],
        });
      }
    }
  });

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

/**
 * Power/energy-style example (forward mark as spot, year-fraction to delivery).
 * Documented for agents; Bazaar primary input remains OPTION_EXAMPLE_INPUT.
 */
export const OPTION_POWER_EXAMPLE_INPUT = {
  spot: 82.5,
  strike: 80,
  timeToExpiry: 0.25,
  rate: 0.04,
  volatility: 0.35,
  optionType: "call" as const,
  dividendYield: 0,
};

/** American forward-start window example (power-style). */
export const OPTION_AMERICAN_FORWARD_EXAMPLE_INPUT = {
  spot: 82.5,
  strike: 80,
  rate: 0.04,
  volatility: 0.85,
  optionType: "call" as const,
  dividendYield: 0.04,
  optionStyle: "american" as const,
  forwardStart: "2026-09-23T14:00:00.000Z",
  expiration: "2026-09-24T02:00:00.000Z",
  treeSteps: 200,
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
  inputs: {
    ...OPTION_EXAMPLE_INPUT,
    optionStyle: "european" as const,
    model: "bsm" as const,
    greekConvention: "raw" as const,
  },
  model: "black-scholes-merton" as const,
  optionStyle: "european" as const,
  timeline: {
    forwardStart: "2026-01-01T00:00:00.000Z",
    expiration: "2027-01-01T06:00:00.000Z",
    effectiveStart: "2026-01-01T00:00:00.000Z",
    tauYears: 1,
    calendarYearsToExpiry: 1,
    yearBasis: "ACT/365.25" as const,
  },
  greeksQuality: "analytic" as const,
  greekConvention: "raw" as const,
  units: {
    price: "option value in spot/forward currency units",
    delta: "dV/dS or dV/dF (share / forward equivalent)",
    gamma: "d²V/dS² or d²V/dF²",
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
  title: "OptionPriceRequest",
  description:
    "European (default) or American option fair value. Legacy bodies use timeToExpiry year-fractions. Optional forwardStart+expiration (ISO-8601 with Z/offset) define a vol/exercise window; τ = years in that window (ACT/365.25), not calendar time from purchase. Not a swing/multi-exercise engine.",
  properties: {
    spot: {
      type: "number",
      description:
        "Underlying price S (> 0). Equity spot OR power/commodity forward mark for the option's window.",
      exclusiveMinimum: 0,
      examples: [100, 82.5, 45.5],
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
        "Time to expiry T in years (≥ 0). Required unless expiration is set. Mutually exclusive with expiration.",
      minimum: 0,
      examples: [0.25, 1.0],
    },
    rate: {
      type: "number",
      description:
        "Continuously compounded risk-free rate r (e.g. 0.05 = 5%). For futures-style early exercise set r≈dividendYield.",
      examples: [0.03, 0.05],
    },
    volatility: {
      type: "number",
      description:
        "Annualized volatility σ as a decimal (> 0). Applies over the vol-accrual window τ.",
      exclusiveMinimum: 0,
      examples: [0.15, 0.2, 0.45],
    },
    optionType: {
      type: "string",
      enum: ["call", "put"],
      description: "Call or put.",
    },
    dividendYield: {
      type: "number",
      description:
        "Continuous dividend / convenience / yield q (≥ 0, default 0).",
      minimum: 0,
      examples: [0, 0.02],
    },
    optionStyle: {
      type: "string",
      enum: ["european", "american"],
      description: 'Exercise style (default "european"). American uses CRR binomial with early exercise.',
      default: "european",
    },
    forwardStart: {
      type: "string",
      format: "date-time",
      description:
        "ISO-8601 start of vol/exercise window. If ≤ now, behaves like plain option to expiration.",
    },
    expiration: {
      type: "string",
      format: "date-time",
      description:
        "ISO-8601 end of vol/exercise window. Mutually exclusive with timeToExpiry.",
    },
    treeSteps: {
      type: "integer",
      minimum: 50,
      maximum: 500,
      description: "CRR steps for American (default 200 on single price).",
    },
    forward: {
      type: "number",
      description:
        "Forward mark F for model=black76 (preferred). If omitted, spot is used as F.",
      exclusiveMinimum: 0,
      examples: [100, 82.5],
    },
    model: {
      type: "string",
      enum: ["bsm", "black76"],
      default: "bsm",
      description:
        'Pricing model: "bsm" (default European BSM on spot) or "black76" (forward/futures).',
    },
    greekConvention: {
      type: "string",
      enum: ["raw", "trading"],
      default: "raw",
      description:
        'Greek units: "raw" (vega/1.0 vol, theta/year, rho/1.0 rate) or "trading" (vega/1%, theta/day, rho/bp).',
    },
  },
  required: ["spot", "strike", "rate", "volatility", "optionType"],
  additionalProperties: false,
} as const;

export const optionOutputJsonSchema = {
  type: "object",
  title: "OptionPriceResponse",
  description:
    "Fair value and Greeks. European Greeks are analytic BSM; American Greeks are finite-difference on the CRR tree. timeline.tauYears is the model life (window); calendarYearsToExpiry is purchase→expiry.",
  properties: {
    price: {
      type: "number",
      description: "Model option fair value in underlying currency units",
    },
    greeks: {
      type: "object",
      description: "Greeks for hedge construction",
      properties: {
        delta: { type: "number", description: "∂V/∂S" },
        gamma: { type: "number", description: "∂²V/∂S²" },
        vega: { type: "number", description: "∂V/∂σ per 1.0 absolute vol" },
        theta: { type: "number", description: "∂V/∂T per year" },
        rho: { type: "number", description: "∂V/∂r per 1.0 absolute rate" },
      },
      required: ["delta", "gamma", "vega", "theta", "rho"],
    },
    inputs: {
      type: "object",
      description: "Echo of validated request inputs (timeToExpiry may be resolved τ)",
    },
    model: {
      type: "string",
      enum: ["black-scholes-merton", "binomial-crr-american"],
    },
    optionStyle: { type: "string", enum: ["european", "american"] },
    timeline: {
      type: "object",
      description: "Resolved ACT/365.25 window",
    },
    greeksQuality: {
      type: "string",
      enum: ["analytic", "finite-difference"],
    },
    treeSteps: { type: "integer" },
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
  required: [
    "price",
    "greeks",
    "inputs",
    "model",
    "optionStyle",
    "timeline",
    "greeksQuality",
    "requestId",
    "computedAt",
  ],
} as const;
