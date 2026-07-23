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

export const surfaceOptionRowSchema = z
  .object({
    underlying: finitePositive.describe(
      "Underlying price S for this option (may differ by maturity)",
    ),
    strike: finitePositive.describe("Strike price K"),
    timeToExpiry: finiteNonNegative.describe("Time to expiry in years T"),
    optionType: z.enum(["call", "put"]).describe("Option type"),
    premium: finiteNonNegative.describe("Market option premium"),
  })
  .strict();

export const volatilitySurfaceInputSchema = z
  .object({
    rate: finiteNumber.describe("Shared continuous risk-free rate r"),
    dividendYield: finiteNonNegative
      .optional()
      .default(0)
      .describe("Shared continuous dividend yield q (default 0)"),
    options: z
      .array(surfaceOptionRowSchema)
      .min(1, "at least one option required")
      .max(
        config.maxSurfaceOptions,
        `at most ${config.maxSurfaceOptions} options`,
      ),
  })
  .strict();

export type VolatilitySurfaceInput = z.infer<typeof volatilitySurfaceInputSchema>;

/** Bazaar / docs example — multi-maturity underlyings (e.g. forward marks). */
export const VOL_SURFACE_EXAMPLE_INPUT = {
  rate: 0.05,
  dividendYield: 0,
  options: [
    {
      underlying: 100,
      strike: 90,
      timeToExpiry: 0.25,
      optionType: "call" as const,
      premium: 12.5,
    },
    {
      underlying: 102,
      strike: 100,
      timeToExpiry: 0.5,
      optionType: "call" as const,
      premium: 8.7,
    },
    {
      underlying: 101,
      strike: 110,
      timeToExpiry: 1.0,
      optionType: "put" as const,
      premium: 9.1,
    },
  ],
};

export const VOL_SURFACE_EXAMPLE_OUTPUT = {
  surface: {
    strikes: [90, 100, 110],
    maturities: [0.25, 0.5, 1],
    impliedVols: [
      [0.25, null, null],
      [null, 0.22, null],
      [null, null, 0.2],
    ],
  },
  market: { rate: 0.05, dividendYield: 0 },
  points: [
    {
      index: 0,
      underlying: 100,
      strike: 90,
      timeToExpiry: 0.25,
      optionType: "call",
      premium: 12.5,
      impliedVol: 0.25,
      greeks: {
        delta: 0.75,
        gamma: 0.02,
        vega: 15,
        theta: -8,
        rho: 10,
      },
      modelPrice: 12.5,
      priceError: 0,
      status: "ok",
    },
  ],
  fit: {
    okCount: 3,
    failedCount: 0,
    meanAbsPriceError: 1e-8,
    maxAbsPriceError: 2e-8,
    rmsePriceError: 1.2e-8,
  },
  stats: {
    optionCount: 3,
    elapsedMs: 1.2,
    solver: "fastImpliedVol",
    avgIterations: 4,
  },
  requestId: "00000000-0000-4000-8000-000000000002",
  computedAt: "2026-01-01T00:00:00.000Z",
};

export const volatilitySurfaceInputJsonSchema = {
  type: "object",
  title: "ImpliedVolatilitySurfaceRequest",
  description:
    "Build an IV surface from a market option book. Share funding rate and yield; attach each quote's own underlying (supports different forward marks by maturity — common in power, gas, and commodity curves).",
  properties: {
    rate: {
      type: "number",
      description:
        "Shared continuous risk-free / discount rate r for the book (e.g. 0.05 = 5%).",
      examples: [0.03, 0.05],
    },
    dividendYield: {
      type: "number",
      description:
        "Shared continuous yield q (default 0): equity dividends, FX foreign rate, or commodity convenience yield as appropriate.",
      minimum: 0,
      examples: [0, 0.01],
    },
    options: {
      type: "array",
      description:
        "Market quotes: one object per (underlying, strike, maturity, type) with observed premium. Prefer unique keys per cell; duplicates average into the grid.",
      minItems: 1,
      maxItems: 200,
      items: {
        type: "object",
        title: "MarketOptionQuote",
        properties: {
          underlying: {
            type: "number",
            description:
              "Underlying level S for this quote (> 0). May differ by maturity (e.g. monthly power/gas forwards).",
            exclusiveMinimum: 0,
            examples: [100, 82.5],
          },
          strike: {
            type: "number",
            description: "Strike K (> 0) in same units as underlying.",
            exclusiveMinimum: 0,
          },
          timeToExpiry: {
            type: "number",
            description: "Year-fraction to expiry T (≥ 0).",
            minimum: 0,
            examples: [0.25, 0.5, 1.0],
          },
          optionType: {
            type: "string",
            enum: ["call", "put"],
            description: "European call or put.",
          },
          premium: {
            type: "number",
            description:
              "Observed market premium (≥ 0) in underlying currency units.",
            minimum: 0,
          },
        },
        required: [
          "underlying",
          "strike",
          "timeToExpiry",
          "optionType",
          "premium",
        ],
        additionalProperties: false,
      },
    },
  },
  required: ["rate", "options"],
  additionalProperties: false,
} as const;

export const volatilitySurfaceOutputJsonSchema = {
  type: "object",
  title: "ImpliedVolatilitySurfaceResponse",
  description:
    "Strike×maturity IV grid, per-quote IV and Greeks, fit diagnostics, and solver stats for agent risk and market-making pipelines.",
  properties: {
    surface: {
      type: "object",
      description: "Dense IV grid derived from successful inversions",
      properties: {
        strikes: {
          type: "array",
          items: { type: "number" },
          description: "Sorted unique strikes from the book",
        },
        maturities: {
          type: "array",
          items: { type: "number" },
          description: "Sorted unique year-fraction maturities",
        },
        impliedVols: {
          type: "array",
          description:
            "Grid [strikeIndex][maturityIndex]; null where no successful quote mapped",
          items: {
            type: "array",
            items: { type: ["number", "null"] },
          },
        },
      },
      required: ["strikes", "maturities", "impliedVols"],
    },
    market: {
      type: "object",
      description: "Echo of shared rate and yield",
      properties: {
        rate: { type: "number" },
        dividendYield: { type: "number" },
      },
    },
    points: {
      type: "array",
      description:
        "Per-input quote results: IV, Greeks, model price vs premium, status",
      items: {
        type: "object",
        properties: {
          index: { type: "integer" },
          underlying: { type: "number" },
          strike: { type: "number" },
          timeToExpiry: { type: "number" },
          optionType: { type: "string", enum: ["call", "put"] },
          premium: { type: "number" },
          impliedVol: {
            type: ["number", "null"],
            description: "Solved annualized IV or null if failed",
          },
          greeks: {
            type: ["object", "null"],
            description: "Analytic Greeks at solved IV (null if failed)",
          },
          modelPrice: { type: ["number", "null"] },
          priceError: {
            type: ["number", "null"],
            description: "modelPrice − premium",
          },
          status: { type: "string", enum: ["ok", "failed"] },
          reason: {
            type: "string",
            description: "Failure reason when status=failed",
          },
        },
      },
    },
    fit: {
      type: "object",
      description: "Book-level inversion quality metrics",
      properties: {
        okCount: { type: "integer" },
        failedCount: { type: "integer" },
        meanAbsPriceError: { type: ["number", "null"] },
        maxAbsPriceError: { type: ["number", "null"] },
        rmsePriceError: { type: ["number", "null"] },
      },
    },
    stats: {
      type: "object",
      description: "Compute telemetry for agents (latency, solver id)",
      properties: {
        optionCount: { type: "integer" },
        elapsedMs: { type: "number" },
        solver: { type: "string", const: "fastImpliedVol" },
        avgIterations: { type: "number" },
      },
    },
    requestId: { type: "string" },
    computedAt: { type: "string" },
  },
  required: [
    "surface",
    "market",
    "points",
    "fit",
    "stats",
    "requestId",
    "computedAt",
  ],
} as const;
