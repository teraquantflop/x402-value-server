import { describe, expect, it } from "vitest";
import {
  computeGreeks,
  normCdf,
  priceOption,
  priceWithGreeks,
} from "../src/services/blackScholes.js";
import type { OptionInputs } from "../src/types.js";

const ATM_CALL: OptionInputs = {
  spot: 100,
  strike: 100,
  timeToExpiry: 1,
  rate: 0.05,
  volatility: 0.2,
  optionType: "call",
  dividendYield: 0,
};

const ATM_PUT: OptionInputs = { ...ATM_CALL, optionType: "put" };

describe("normCdf", () => {
  it("is ~0.5 at 0", () => {
    expect(normCdf(0)).toBeCloseTo(0.5, 6);
  });

  it("approaches 1 for large positive x", () => {
    expect(normCdf(5)).toBeGreaterThan(0.99999);
  });

  it("approaches 0 for large negative x", () => {
    expect(normCdf(-5)).toBeLessThan(0.00001);
  });
});

describe("priceOption", () => {
  it("prices ATM 1Y call near textbook value (~10.45)", () => {
    const price = priceOption(ATM_CALL);
    // Hull-style reference: S=K=100, r=5%, σ=20%, T=1 → ~10.4506
    expect(price).toBeCloseTo(10.4506, 2);
  });

  it("satisfies put-call parity for European options (q=0)", () => {
    const call = priceOption(ATM_CALL);
    const put = priceOption(ATM_PUT);
    const parity = ATM_CALL.spot - ATM_CALL.strike * Math.exp(-ATM_CALL.rate * ATM_CALL.timeToExpiry);
    expect(call - put).toBeCloseTo(parity, 4);
  });

  it("returns intrinsic at expiry", () => {
    const call = priceOption({ ...ATM_CALL, timeToExpiry: 0, spot: 110, strike: 100 });
    const put = priceOption({ ...ATM_PUT, timeToExpiry: 0, spot: 90, strike: 100 });
    expect(call).toBeCloseTo(10, 8);
    expect(put).toBeCloseTo(10, 8);
  });

  it("OTM expired options are zero", () => {
    expect(
      priceOption({ ...ATM_CALL, timeToExpiry: 0, spot: 90, strike: 100 }),
    ).toBe(0);
    expect(
      priceOption({ ...ATM_PUT, timeToExpiry: 0, spot: 110, strike: 100 }),
    ).toBe(0);
  });
});

describe("computeGreeks", () => {
  it("returns all five Greeks for ATM call", () => {
    const g = computeGreeks(ATM_CALL);
    expect(g.delta).toBeGreaterThan(0.5);
    expect(g.delta).toBeLessThan(0.8);
    expect(g.gamma).toBeGreaterThan(0);
    expect(g.vega).toBeGreaterThan(0);
    expect(g.rho).toBeGreaterThan(0);
    // Call theta typically negative for long options
    expect(g.theta).toBeLessThan(0);
  });

  it("put delta is between -1 and 0 for ATM", () => {
    const g = computeGreeks(ATM_PUT);
    expect(g.delta).toBeLessThan(0);
    expect(g.delta).toBeGreaterThan(-1);
  });

  it("call and put share gamma and vega", () => {
    const c = computeGreeks(ATM_CALL);
    const p = computeGreeks(ATM_PUT);
    expect(c.gamma).toBeCloseTo(p.gamma, 8);
    expect(c.vega).toBeCloseTo(p.vega, 8);
  });

  it("delta ~ exp(-qT) for deep ITM call", () => {
    const g = computeGreeks({
      ...ATM_CALL,
      spot: 200,
      strike: 100,
      volatility: 0.1,
    });
    expect(g.delta).toBeGreaterThan(0.99);
  });
});

describe("priceWithGreeks", () => {
  it("returns rounded full payload", () => {
    const result = priceWithGreeks(ATM_CALL, "test-id", "2026-01-01T00:00:00.000Z");
    expect(result.requestId).toBe("test-id");
    expect(result.model).toBe("black-scholes-merton");
    expect(result.price).toBeCloseTo(10.45, 2);
    expect(result.greeks).toHaveProperty("delta");
    expect(result.greeks).toHaveProperty("gamma");
    expect(result.greeks).toHaveProperty("vega");
    expect(result.greeks).toHaveProperty("theta");
    expect(result.greeks).toHaveProperty("rho");
    expect(result.units.vega).toMatch(/1\.0/);
  });
});
