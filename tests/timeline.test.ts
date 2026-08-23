import { describe, expect, it } from "vitest";
import {
  TimelineError,
  YEAR_MS,
  resolveOptionTimeline,
  yearsBetween,
} from "../src/services/timeline.js";

describe("yearsBetween", () => {
  it("uses ACT/365.25", () => {
    expect(yearsBetween(0, YEAR_MS)).toBeCloseTo(1, 12);
  });
});

describe("resolveOptionTimeline", () => {
  const now = Date.parse("2026-08-23T21:40:00.000Z");

  it("legacy timeToExpiry only", () => {
    const t = resolveOptionTimeline({ timeToExpiry: 1, nowMs: now });
    expect(t.tauYears).toBeCloseTo(1, 10);
    expect(t.calendarYearsToExpiry).toBeCloseTo(1, 10);
    expect(t.yearBasis).toBe("ACT/365.25");
    expect(t.effectiveStart).toBe(new Date(now).toISOString());
  });

  it("forwardStart in future uses window length as τ", () => {
    const t = resolveOptionTimeline({
      forwardStart: "2026-09-23T14:00:00.000Z",
      expiration: "2026-09-24T02:00:00.000Z",
      nowMs: now,
    });
    // 12 hours
    expect(t.tauYears).toBeCloseTo(12 / (365.25 * 24), 8);
    expect(t.calendarYearsToExpiry).toBeGreaterThan(t.tauYears);
  });

  it("forwardStart <= now clamps to remaining life", () => {
    const t = resolveOptionTimeline({
      forwardStart: "2026-08-01T00:00:00.000Z",
      expiration: "2026-08-24T21:40:00.000Z",
      nowMs: now,
    });
    expect(t.effectiveStart).toBe(new Date(now).toISOString());
    expect(t.tauYears).toBeCloseTo(1 / 365.25, 6);
  });

  it("rejects expiration before forwardStart", () => {
    expect(() =>
      resolveOptionTimeline({
        forwardStart: "2026-09-24T00:00:00.000Z",
        expiration: "2026-09-23T00:00:00.000Z",
        nowMs: now,
      }),
    ).toThrow(TimelineError);
  });

  it("rejects ambiguous expiration + timeToExpiry", () => {
    try {
      resolveOptionTimeline({
        expiration: "2026-09-23T00:00:00.000Z",
        timeToExpiry: 1,
        nowMs: now,
      });
      expect.fail("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(TimelineError);
      expect((err as TimelineError).code).toBe("timeline_ambiguous");
    }
  });

  it("forwardStart + timeToExpiry builds expiration", () => {
    const t = resolveOptionTimeline({
      forwardStart: "2026-09-23T14:00:00.000Z",
      timeToExpiry: 0.01,
      nowMs: now,
    });
    expect(t.tauYears).toBeCloseTo(0.01, 8);
  });
});
