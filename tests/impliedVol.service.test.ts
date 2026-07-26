import { describe, expect, it } from "vitest";
import { priceOption } from "../src/services/blackScholes.js";
import { solveImpliedVol } from "../src/services/impliedVol.js";

describe("solveImpliedVol", () => {
  it("recovers known vol and returns Greeks", () => {
    const sigma = 0.2;
    const premium = priceOption({
      spot: 100,
      strike: 100,
      timeToExpiry: 1,
      rate: 0.05,
      dividendYield: 0,
      optionType: "call",
      volatility: sigma,
    });

    const result = solveImpliedVol(
      {
        underlying: 100,
        strike: 100,
        timeToExpiry: 1,
        rate: 0.05,
        dividendYield: 0,
        optionType: "call",
        premium,
      },
      "test-req",
      "2026-01-01T00:00:00.000Z",
    );

    expect(result.converged).toBe(true);
    expect(result.impliedVol).toBeCloseTo(sigma, 4);
    expect(result.modelPrice).toBeCloseTo(premium, 6);
    expect(Math.abs(result.priceError)).toBeLessThan(1e-6);
    expect(result.greeks.delta).toBeCloseTo(0.63683059, 4);
    expect(result.iterations).toBeGreaterThan(0);
    expect(result.requestId).toBe("test-req");
  });

  it("fails for premium above theoretical max", () => {
    const result = solveImpliedVol(
      {
        underlying: 100,
        strike: 100,
        timeToExpiry: 1,
        rate: 0.05,
        dividendYield: 0,
        optionType: "call",
        premium: 200,
      },
      "r",
    );
    expect(result.converged).toBe(false);
    expect(result.reason).toBe("premium_above_max");
  });
});
