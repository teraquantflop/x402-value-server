import { describe, expect, it } from "vitest";
import { priceOption } from "../src/services/blackScholes.js";
import { fastImpliedVol } from "../src/services/fastImpliedVol.js";
import { buildVolatilitySurface } from "../src/services/volatilitySurface.js";

const BASE = {
  spot: 100,
  strike: 100,
  timeToExpiry: 1,
  rate: 0.05,
  dividendYield: 0,
  optionType: "call" as const,
};

describe("fastImpliedVol", () => {
  it("round-trips ATM call vol", () => {
    const sigma = 0.2;
    const premium = priceOption({ ...BASE, volatility: sigma });
    const res = fastImpliedVol(BASE, premium);
    expect(res.converged).toBe(true);
    expect(res.sigma).toBeCloseTo(sigma, 4);
  });

  it("round-trips OTM put vol", () => {
    const market = {
      ...BASE,
      strike: 110,
      optionType: "put" as const,
      timeToExpiry: 0.5,
    };
    const sigma = 0.35;
    const premium = priceOption({ ...market, volatility: sigma });
    const res = fastImpliedVol(market, premium);
    expect(res.converged).toBe(true);
    expect(res.sigma).toBeCloseTo(sigma, 3);
  });

  it("fails when premium exceeds max value", () => {
    const res = fastImpliedVol(BASE, 1e9);
    expect(res.converged).toBe(false);
    expect(res.reason).toBe("premium_above_max");
  });
});

describe("buildVolatilitySurface", () => {
  it("builds grid with per-option underlyings", () => {
    const market = { rate: 0.05, dividendYield: 0 };
    const opts = [
      {
        underlying: 100,
        strike: 90,
        timeToExpiry: 0.25,
        optionType: "call" as const,
        premium: priceOption({
          spot: 100,
          strike: 90,
          timeToExpiry: 0.25,
          rate: 0.05,
          dividendYield: 0,
          optionType: "call",
          volatility: 0.25,
        }),
      },
      {
        underlying: 102,
        strike: 100,
        timeToExpiry: 0.5,
        optionType: "call" as const,
        premium: priceOption({
          spot: 102,
          strike: 100,
          timeToExpiry: 0.5,
          rate: 0.05,
          dividendYield: 0,
          optionType: "call",
          volatility: 0.2,
        }),
      },
    ];

    const result = buildVolatilitySurface(market, opts, "test-id");
    expect(result.requestId).toBe("test-id");
    expect(result.stats.solver).toBe("fastImpliedVol");
    expect(result.market).toEqual({ rate: 0.05, dividendYield: 0 });
    expect(result.fit.okCount).toBe(2);
    expect(result.points).toHaveLength(2);
    expect(result.points[0]!.underlying).toBe(100);
    expect(result.points[1]!.underlying).toBe(102);
    expect(result.points[0]!.impliedVol).toBeCloseTo(0.25, 3);
    expect(result.points[1]!.impliedVol).toBeCloseTo(0.2, 3);
    expect(result.surface.strikes).toEqual([90, 100]);
    expect(result.surface.maturities).toEqual([0.25, 0.5]);
    expect(result.surface.impliedVols[0]![0]).toBeCloseTo(0.25, 3);
    expect(result.surface.impliedVols[1]![1]).toBeCloseTo(0.2, 3);
    expect(result.points[0]!.greeks).not.toBeNull();
  });
});
