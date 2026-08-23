import { describe, expect, it } from "vitest";
import { priceOption } from "../src/services/blackScholes.js";
import {
  computeAmericanGreeksFd,
  priceAmericanBinomial,
} from "../src/services/americanBinomial.js";
import { priceOptionDispatch } from "../src/services/priceDispatch.js";

const BASE = {
  spot: 100,
  strike: 100,
  timeToExpiry: 1,
  rate: 0.05,
  volatility: 0.2,
  dividendYield: 0,
  optionType: "put" as const,
  steps: 400,
};

describe("priceAmericanBinomial", () => {
  it("converges to intrinsic at expiry", () => {
    expect(
      priceAmericanBinomial({
        ...BASE,
        timeToExpiry: 0,
        spot: 90,
        optionType: "put",
      }),
    ).toBeCloseTo(10, 8);
    expect(
      priceAmericanBinomial({
        ...BASE,
        timeToExpiry: 0,
        spot: 110,
        optionType: "call",
      }),
    ).toBeCloseTo(10, 8);
  });

  it("American put >= European put (q=0)", () => {
    const am = priceAmericanBinomial(BASE);
    const eu = priceOption({ ...BASE, optionType: "put" });
    expect(am).toBeGreaterThanOrEqual(eu - 1e-6);
  });

  it("American call ≈ European call when q=0", () => {
    const call = { ...BASE, optionType: "call" as const, steps: 500 };
    const am = priceAmericanBinomial(call);
    const eu = priceOption({ ...call });
    expect(am).toBeCloseTo(eu, 1); // tree truncation
  });

  it("deep ITM put shows early-exercise premium vs European", () => {
    const deep = {
      ...BASE,
      spot: 70,
      strike: 100,
      timeToExpiry: 0.5,
      volatility: 0.25,
      optionType: "put" as const,
      steps: 400,
    };
    const am = priceAmericanBinomial(deep);
    const eu = priceOption(deep);
    expect(am).toBeGreaterThan(eu + 0.05);
  });
});

describe("American FD greeks", () => {
  it("call delta is between 0 and 1", () => {
    const g = computeAmericanGreeksFd({
      ...BASE,
      optionType: "call",
      steps: 200,
    });
    expect(g.delta).toBeGreaterThan(0);
    expect(g.delta).toBeLessThan(1);
    expect(Number.isFinite(g.gamma)).toBe(true);
    expect(Number.isFinite(g.vega)).toBe(true);
  });
});

describe("priceOptionDispatch european golden", () => {
  it("matches textbook ATM call", () => {
    const r = priceOptionDispatch(
      {
        spot: 100,
        strike: 100,
        timeToExpiry: 1,
        rate: 0.05,
        volatility: 0.2,
        optionType: "call",
      },
      {
        requestId: "t",
        computedAt: "2026-01-01T00:00:00.000Z",
        nowMs: Date.parse("2026-01-01T00:00:00.000Z"),
      },
    );
    expect(r.model).toBe("black-scholes-merton");
    expect(r.optionStyle).toBe("european");
    expect(r.greeksQuality).toBe("analytic");
    expect(r.price).toBeCloseTo(10.45, 2);
    expect(r.timeline.tauYears).toBeCloseTo(1, 10);
  });

  it("american forward-start uses window τ", () => {
    const r = priceOptionDispatch(
      {
        spot: 82.5,
        strike: 80,
        rate: 0.04,
        volatility: 0.85,
        optionType: "call",
        dividendYield: 0.04,
        optionStyle: "american",
        forwardStart: "2026-09-23T14:00:00.000Z",
        expiration: "2026-09-24T02:00:00.000Z",
        treeSteps: 100,
      },
      {
        requestId: "t",
        computedAt: "2026-08-23T21:40:00.000Z",
        nowMs: Date.parse("2026-08-23T21:40:00.000Z"),
      },
    );
    expect(r.model).toBe("binomial-crr-american");
    expect(r.timeline.tauYears).toBeCloseTo(12 / (365.25 * 24), 6);
    expect(r.price).toBeGreaterThan(0);
    expect(r.greeksQuality).toBe("finite-difference");
  });
});
