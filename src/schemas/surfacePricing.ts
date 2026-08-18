import { z } from "zod";
import { config } from "../config.js";
import {
  SURFACE_CONVENTION,
  SURFACE_INTERPOLATION,
  SURFACE_WING_RULE,
} from "../services/surfaceInterpolator.js";

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

const surfacePointKSchema = z
  .object({
    k: finiteNumber.describe("Log-moneyness k = ln(K/F)"),
    timeToExpiry: finiteNonNegative,
    iv: finitePositive.describe("Implied vol σ > 0"),
  })
  .strict();

const surfacePointStrikeSchema = z
  .object({
    strike: finitePositive,
    underlying: finitePositive.describe("Forward or spot-as-forward F"),
    timeToExpiry: finiteNonNegative,
    iv: finitePositive,
  })
  .strict();

export const surfacePointSchema = z.union([
  surfacePointKSchema,
  surfacePointStrikeSchema,
]);

export const surfaceLegSchema = z
  .object({
    underlying: finitePositive.describe(
      "Forward mark or spot used as F for moneyness and as BS spot",
    ),
    strike: finitePositive,
    timeToExpiry: finiteNonNegative,
    optionType: z.enum(["call", "put"]),
    quantity: finiteNumber.optional().default(1),
    id: z.string().max(64).optional(),
  })
  .strict();

const surfaceSharedFields = {
  surfaceConvention: z
    .literal(SURFACE_CONVENTION)
    .describe("Only log_moneyness_forward is supported in v1"),
  interpolation: z
    .literal(SURFACE_INTERPOLATION)
    .optional()
    .default(SURFACE_INTERPOLATION),
  wingRule: z.literal(SURFACE_WING_RULE).optional().default(SURFACE_WING_RULE),
  rate: finiteNumber,
  dividendYield: finiteNonNegative.optional().default(0),
  surface: z
    .array(surfacePointSchema)
    .min(1)
    .max(config.maxSurfacePoints),
};

export const priceFromSurfaceInputSchema = z
  .object({
    ...surfaceSharedFields,
    options: z
      .array(surfaceLegSchema)
      .min(1)
      .max(config.maxSurfacePriceOptions),
  })
  .strict();

export const scenarioShockSchema = z
  .object({
    underlyingRel: finiteNumber.optional(),
    underlyingAbs: finiteNumber.optional(),
    rateBp: finiteNumber.optional().default(0),
    timeDays: finiteNonNegative.optional().default(0),
    volAbs: finiteNumber.optional().default(0),
    volRel: finiteNumber.optional().default(0),
    smileTwist: finiteNumber
      .optional()
      .default(0)
      .describe("Vol points added per unit log-moneyness k"),
  })
  .strict()
  .superRefine((s, ctx) => {
    if (s.underlyingRel !== undefined && s.underlyingAbs !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Set at most one of underlyingRel or underlyingAbs (not both)",
        path: ["underlyingRel"],
      });
    }
  });

export const scenarioFromSurfaceInputSchema = z
  .object({
    ...surfaceSharedFields,
    sticky: z
      .enum(["moneyness", "strike", "fixed_vol"])
      .optional()
      .default("moneyness"),
    positions: z
      .array(surfaceLegSchema)
      .min(1)
      .max(config.maxSurfacePriceOptions),
    scenario: scenarioShockSchema,
  })
  .strict();

export type PriceFromSurfaceInput = z.infer<typeof priceFromSurfaceInputSchema>;
export type ScenarioFromSurfaceInput = z.infer<
  typeof scenarioFromSurfaceInputSchema
>;

/** 3×3 equity-like smile fixture in (k,T). */
export const SURFACE_PRICE_EXAMPLE_INPUT = {
  surfaceConvention: "log_moneyness_forward" as const,
  interpolation: "total_variance_bilinear" as const,
  wingRule: "flat_vol" as const,
  rate: 0.05,
  dividendYield: 0,
  surface: [
    { k: -0.1, timeToExpiry: 0.25, iv: 0.22 },
    { k: 0, timeToExpiry: 0.25, iv: 0.2 },
    { k: 0.1, timeToExpiry: 0.25, iv: 0.23 },
    { k: -0.1, timeToExpiry: 0.5, iv: 0.21 },
    { k: 0, timeToExpiry: 0.5, iv: 0.2 },
    { k: 0.1, timeToExpiry: 0.5, iv: 0.22 },
    { k: -0.1, timeToExpiry: 1, iv: 0.205 },
    { k: 0, timeToExpiry: 1, iv: 0.2 },
    { k: 0.1, timeToExpiry: 1, iv: 0.215 },
  ],
  options: [
    {
      underlying: 100,
      strike: 100,
      timeToExpiry: 1,
      optionType: "call" as const,
      quantity: 1,
    },
  ],
};

export const SURFACE_SCENARIO_EXAMPLE_INPUT = {
  surfaceConvention: SURFACE_PRICE_EXAMPLE_INPUT.surfaceConvention,
  interpolation: SURFACE_PRICE_EXAMPLE_INPUT.interpolation,
  wingRule: SURFACE_PRICE_EXAMPLE_INPUT.wingRule,
  rate: SURFACE_PRICE_EXAMPLE_INPUT.rate,
  dividendYield: SURFACE_PRICE_EXAMPLE_INPUT.dividendYield,
  surface: SURFACE_PRICE_EXAMPLE_INPUT.surface,
  sticky: "moneyness" as const,
  positions: SURFACE_PRICE_EXAMPLE_INPUT.options,
  scenario: {
    underlyingRel: 0.1,
    rateBp: 0,
    timeDays: 0,
    volAbs: 0,
    volRel: 0,
    smileTwist: 0,
  },
};

/** Commodity/power-style forwards: strike+underlying points (server converts to k). */
export const SURFACE_PRICE_COMMODITY_EXAMPLE_INPUT = {
  surfaceConvention: "log_moneyness_forward" as const,
  interpolation: "total_variance_bilinear" as const,
  wingRule: "flat_vol" as const,
  rate: 0.04,
  dividendYield: 0.02,
  surface: [
    { strike: 45, underlying: 50, timeToExpiry: 0.25, iv: 0.35 },
    { strike: 50, underlying: 50, timeToExpiry: 0.25, iv: 0.3 },
    { strike: 55, underlying: 50, timeToExpiry: 0.25, iv: 0.32 },
    { strike: 45, underlying: 52, timeToExpiry: 0.5, iv: 0.33 },
    { strike: 50, underlying: 52, timeToExpiry: 0.5, iv: 0.28 },
    { strike: 55, underlying: 52, timeToExpiry: 0.5, iv: 0.3 },
  ],
  options: [
    {
      underlying: 50,
      strike: 50,
      timeToExpiry: 0.25,
      optionType: "call" as const,
      quantity: 1,
      id: "pwr-atm-q1",
    },
  ],
};

export const priceFromSurfaceInputJsonSchema = {
  type: "object",
  title: "PriceFromSurfaceRequest",
  description:
    "Price European options on a submitted IV surface via total-variance bilinear interpolation in log-moneyness k=ln(K/F).",
  properties: {
    surfaceConvention: { type: "string", const: "log_moneyness_forward" },
    interpolation: { type: "string", const: "total_variance_bilinear" },
    wingRule: { type: "string", const: "flat_vol" },
    rate: { type: "number" },
    dividendYield: { type: "number", minimum: 0 },
    surface: { type: "array", minItems: 1, maxItems: 200 },
    options: { type: "array", minItems: 1, maxItems: 50 },
  },
  required: ["surfaceConvention", "rate", "surface", "options"],
  additionalProperties: false,
} as const;

export const scenarioFromSurfaceInputJsonSchema = {
  type: "object",
  title: "ScenarioFromSurfaceRequest",
  description:
    "Revalue a book on an IV surface under sticky moneyness/strike/fixed_vol with optional F, rate, time, and vol shocks (incl. smileTwist).",
  properties: {
    ...priceFromSurfaceInputJsonSchema.properties,
    sticky: {
      type: "string",
      enum: ["moneyness", "strike", "fixed_vol"],
    },
    positions: { type: "array", minItems: 1, maxItems: 50 },
    scenario: { type: "object" },
  },
  required: ["surfaceConvention", "rate", "surface", "positions", "scenario"],
  additionalProperties: false,
} as const;

export const priceFromSurfaceOutputJsonSchema = {
  type: "object",
  properties: {
    results: { type: "array" },
    book: { type: "object" },
    warnings: { type: "array", items: { type: "string" } },
    requestId: { type: "string" },
    computedAt: { type: "string" },
  },
  required: ["results", "warnings", "requestId", "computedAt"],
} as const;

export const scenarioFromSurfaceOutputJsonSchema = {
  type: "object",
  properties: {
    sticky: { type: "string" },
    scenario: { type: "object" },
    legs: { type: "array" },
    book: { type: "object" },
    warnings: { type: "array", items: { type: "string" } },
    requestId: { type: "string" },
    computedAt: { type: "string" },
  },
  required: ["legs", "book", "warnings", "requestId", "computedAt"],
} as const;
