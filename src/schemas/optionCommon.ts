/**
 * Shared Zod fragments for option style + absolute timelines.
 * Additive: defaults preserve legacy European year-fraction bodies.
 */
import { z } from "zod";

export const optionStyleSchema = z
  .enum(["european", "american"])
  .default("european")
  .describe('Exercise style (default "european")');

/** ISO-8601 date-time with timezone offset or Z (not date-only). */
export const isoDateTimeSchema = z
  .string()
  .datetime({ offset: true })
  .describe("ISO-8601 datetime with timezone (e.g. 2026-09-23T14:00:00.000Z)");

export const treeStepsSchema = z
  .number({ invalid_type_error: "must be a number" })
  .int("must be an integer")
  .min(50, "treeSteps must be >= 50")
  .max(500, "treeSteps must be <= 500")
  .describe("CRR binomial steps for American (50–500)");

const finiteNonNegative = z
  .number({ invalid_type_error: "must be a number" })
  .finite("must be finite")
  .nonnegative("must be >= 0");

/**
 * Timeline refine shared by single-option bodies.
 * - Neither timestamp → timeToExpiry required (legacy).
 * - Only forwardStart → timeToExpiry required (window length from start).
 * - expiration set → timeToExpiry must be absent (no ambiguity).
 * - Both timestamps → expiration > forwardStart checked in timeline service too.
 */
export function refineOptionTimeline(
  data: {
    timeToExpiry?: number;
    forwardStart?: string;
    expiration?: string;
  },
  ctx: z.RefinementCtx,
): void {
  const hasT = data.timeToExpiry !== undefined;
  const hasFs = data.forwardStart !== undefined;
  const hasExp = data.expiration !== undefined;

  if (hasExp && hasT) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "timeline_ambiguous: provide expiration OR timeToExpiry, not both",
      path: ["timeToExpiry"],
    });
    return;
  }

  if (!hasExp && !hasT) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "timeToExpiry is required when expiration is omitted (or supply expiration)",
      path: ["timeToExpiry"],
    });
    return;
  }

  if (hasFs && !hasExp && !hasT) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "timeToExpiry is required when only forwardStart is set (defines window length)",
      path: ["timeToExpiry"],
    });
  }

  if (hasFs && hasExp) {
    const t0 = Date.parse(data.forwardStart!);
    const t1 = Date.parse(data.expiration!);
    if (!Number.isFinite(t0) || !Number.isFinite(t1)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "timeline_invalid: forwardStart/expiration must be parseable ISO-8601",
        path: ["expiration"],
      });
      return;
    }
    if (t1 <= t0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "expiration_before_start: expiration must be after forwardStart",
        path: ["expiration"],
      });
    }
  }
}

/** Optional year-fraction used when absolute expiration is absent. */
export const optionalTimeToExpirySchema = finiteNonNegative
  .optional()
  .describe(
    "Time to expiry in years T. Required unless expiration is provided. Mutually exclusive with expiration.",
  );
