/**
 * Option timeline resolution (ACT/365.25).
 *
 * v1 forward-start convention:
 *   Volatility and exercise rights live only in [effectiveStart, expiration],
 *   where effectiveStart = max(forwardStart, now) when forwardStart is set,
 *   else now. Model τ = yearsBetween(effectiveStart, expiration).
 *   Spot is the client-supplied mark (no extra PV discount now→forwardStart).
 *
 * Not a swing engine — single exercise window only.
 */
import type { OptionTimeline } from "../types.js";

/** Mean Gregorian year length used for year-fractions. */
export const YEAR_MS = 365.25 * 24 * 60 * 60 * 1000;
export const YEAR_BASIS = "ACT/365.25" as const;

export class TimelineError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "TimelineError";
    this.code = code;
  }
}

export function yearsBetween(startMs: number, endMs: number): number {
  return (endMs - startMs) / YEAR_MS;
}

export function addYears(startMs: number, years: number): number {
  return startMs + years * YEAR_MS;
}

export function toIso(ms: number): string {
  return new Date(ms).toISOString();
}

export type TimelineRequest = {
  timeToExpiry?: number;
  forwardStart?: string;
  expiration?: string;
  /** Evaluation instant (default Date.now()). */
  nowMs?: number;
};

/**
 * Resolve absolute window + model τ from request fields.
 * Caller should already Zod-validate mutual exclusion rules.
 */
export function resolveOptionTimeline(req: TimelineRequest): OptionTimeline {
  const nowMs = req.nowMs ?? Date.now();
  const hasT = req.timeToExpiry !== undefined;
  const hasFs = req.forwardStart !== undefined;
  const hasExp = req.expiration !== undefined;

  if (hasExp && hasT) {
    throw new TimelineError(
      "timeline_ambiguous",
      "Provide expiration OR timeToExpiry, not both",
    );
  }

  let forwardStartMs: number;
  let expirationMs: number;

  if (hasFs && hasExp) {
    forwardStartMs = Date.parse(req.forwardStart!);
    expirationMs = Date.parse(req.expiration!);
    if (!Number.isFinite(forwardStartMs) || !Number.isFinite(expirationMs)) {
      throw new TimelineError(
        "timeline_invalid",
        "forwardStart/expiration must be parseable ISO-8601",
      );
    }
    if (expirationMs <= forwardStartMs) {
      throw new TimelineError(
        "expiration_before_start",
        "expiration must be after forwardStart",
      );
    }
  } else if (hasExp && !hasFs) {
    forwardStartMs = nowMs;
    expirationMs = Date.parse(req.expiration!);
    if (!Number.isFinite(expirationMs)) {
      throw new TimelineError(
        "timeline_invalid",
        "expiration must be parseable ISO-8601",
      );
    }
  } else if (hasFs && hasT) {
    forwardStartMs = Date.parse(req.forwardStart!);
    if (!Number.isFinite(forwardStartMs)) {
      throw new TimelineError(
        "timeline_invalid",
        "forwardStart must be parseable ISO-8601",
      );
    }
    expirationMs = addYears(forwardStartMs, req.timeToExpiry!);
  } else if (hasT) {
    forwardStartMs = nowMs;
    expirationMs = addYears(nowMs, req.timeToExpiry!);
  } else {
    throw new TimelineError(
      "timeline_invalid",
      "Need timeToExpiry and/or expiration to resolve timeline",
    );
  }

  // Clamp start to now: if window already open, life is remaining time to expiry.
  const effectiveStartMs = Math.max(forwardStartMs, nowMs);
  let tauYears = yearsBetween(effectiveStartMs, expirationMs);
  if (tauYears < 0) {
    // expiration already passed relative to now
    tauYears = 0;
  }

  const calendarYearsToExpiry = Math.max(0, yearsBetween(nowMs, expirationMs));

  return {
    forwardStart: toIso(forwardStartMs),
    expiration: toIso(expirationMs),
    effectiveStart: toIso(effectiveStartMs),
    tauYears,
    calendarYearsToExpiry,
    yearBasis: YEAR_BASIS,
  };
}
