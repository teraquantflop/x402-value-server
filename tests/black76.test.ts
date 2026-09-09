/**
 * Phase 4: Black-76 forward options + greekConvention raw|trading.
 */
import { describe, expect, it } from "vitest";
import { computeBlack76Greeks, priceBlack76 } from "../src/services/black76.js";
import { priceOptionDispatch } from "../src/services/priceDispatch.js";
import { optionInputSchema } from "../src/schemas/option.js";
import { priceOption } from "../src/services/blackScholes.js";

describe("priceBlack76", () => {
  it("ATM forward call ≈ 7.58 for F=K=100, r=5%, σ=20%, T=1", () => {
    const p = priceBlack76({
      forward: 100,
      strike: 100,
      timeToExpiry: 1,
      rate: 0.05,
      volatility: 0.2,
      optionType: "call",
    });
    // DF * (F N(d1)-K N(d2)) with d1=0.1, d2=-0.1 → ~7.577
    expect(p).toBeCloseTo(7.577, 2);
  });

  it("matches BSM when q=r (F=S)", () => {
    const S = 100;
    const r = 0.05;
    const T = 1;
    const sigma = 0.25;
    const K = 105;
    const bsm = priceOption({
      spot: S,
      strike: K,
      timeToExpiry: T,
      rate: r,
      volatility: sigma,
      dividendYield: r,
      optionType: "call",
    });
    const b76 = priceBlack76({
      forward: S, // F = S e^{(r-q)T} = S when q=r
      strike: K,
      timeToExpiry: T,
      rate: r,
      volatility: sigma,
      optionType: "call",
    });
    expect(b76).toBeCloseTo(bsm, 6);
  });

  it("put-call parity: c-p = e^{-rT}(F-K)", () => {
    const F = 110;
    const K = 100;
    const r = 0.03;
    const T = 0.5;
    const sigma = 0.3;
    const c = priceBlack76({
      forward: F,
      strike: K,
      timeToExpiry: T,
      rate: r,
      volatility: sigma,
      optionType: "call",
    });
    const p = priceBlack76({
      forward: F,
      strike: K,
      timeToExpiry: T,
      rate: r,
      volatility: sigma,
      optionType: "put",
    });
    expect(c - p).toBeCloseTo(Math.exp(-r * T) * (F - K), 6);
  });
});

describe("greekConvention via priceOptionDispatch", () => {
  const base = {
    spot: 100,
    strike: 100,
    timeToExpiry: 1,
    rate: 0.05,
    volatility: 0.2,
    optionType: "call" as const,
  };

  it("trading = raw scaled (vega×0.01, theta/365, rho×1e-4)", () => {
    const raw = priceOptionDispatch(
      { ...base, greekConvention: "raw" },
      {
        requestId: "t",
        computedAt: "2026-01-01T00:00:00.000Z",
        nowMs: Date.parse("2026-01-01T00:00:00.000Z"),
      },
    );
    const trading = priceOptionDispatch(
      { ...base, greekConvention: "trading" },
      {
        requestId: "t",
        computedAt: "2026-01-01T00:00:00.000Z",
        nowMs: Date.parse("2026-01-01T00:00:00.000Z"),
      },
    );
    expect(trading.price).toBe(raw.price);
    expect(trading.greeks.delta).toBeCloseTo(raw.greeks.delta, 8);
    expect(trading.greeks.vega).toBeCloseTo(raw.greeks.vega * 0.01, 8);
    expect(trading.greeks.theta).toBeCloseTo(raw.greeks.theta / 365, 8);
    expect(trading.greeks.rho).toBeCloseTo(raw.greeks.rho * 0.0001, 8);
    expect(trading.greekConvention).toBe("trading");
    expect(trading.units.vega).toMatch(/1%/);
  });

  it("black76 dispatch with forward", () => {
    const r = priceOptionDispatch(
      {
        forward: 100,
        strike: 100,
        timeToExpiry: 1,
        rate: 0.05,
        volatility: 0.2,
        optionType: "call",
        model: "black76",
      },
      {
        requestId: "t",
        computedAt: "2026-01-01T00:00:00.000Z",
        nowMs: Date.parse("2026-01-01T00:00:00.000Z"),
      },
    );
    expect(r.model).toBe("black-76");
    expect(r.price).toBeCloseTo(7.577, 2);
    expect(r.greeks.delta).toBeGreaterThan(0);
    expect(r.greeks.delta).toBeLessThan(1);
  });

  it("legacy BSM body unchanged (bit-close to textbook)", () => {
    const r = priceOptionDispatch(base, {
      requestId: "t",
      computedAt: "2026-01-01T00:00:00.000Z",
      nowMs: Date.parse("2026-01-01T00:00:00.000Z"),
    });
    expect(r.model).toBe("black-scholes-merton");
    expect(r.price).toBeCloseTo(10.45, 2);
    expect(r.greekConvention).toBe("raw");
  });
});

describe("optionInputSchema black76", () => {
  it("accepts forward-only black76", () => {
    const r = optionInputSchema.safeParse({
      forward: 100,
      strike: 100,
      timeToExpiry: 1,
      rate: 0.05,
      volatility: 0.2,
      optionType: "call",
      model: "black76",
    });
    expect(r.success).toBe(true);
  });

  it("rejects black76 with dividendYield > 0", () => {
    const r = optionInputSchema.safeParse({
      forward: 100,
      strike: 100,
      timeToExpiry: 1,
      rate: 0.05,
      volatility: 0.2,
      optionType: "call",
      model: "black76",
      dividendYield: 0.02,
    });
    expect(r.success).toBe(false);
  });

  it("rejects black76 + american", () => {
    const r = optionInputSchema.safeParse({
      forward: 100,
      strike: 100,
      timeToExpiry: 1,
      rate: 0.05,
      volatility: 0.2,
      optionType: "call",
      model: "black76",
      optionStyle: "american",
    });
    expect(r.success).toBe(false);
  });

  it("still requires spot for bsm", () => {
    const r = optionInputSchema.safeParse({
      strike: 100,
      timeToExpiry: 1,
      rate: 0.05,
      volatility: 0.2,
      optionType: "call",
      model: "bsm",
    });
    expect(r.success).toBe(false);
  });
});

describe("Black-76 greeks finite", () => {
  it("ATM call delta between 0 and DF", () => {
    const g = computeBlack76Greeks({
      forward: 100,
      strike: 100,
      timeToExpiry: 1,
      rate: 0.05,
      volatility: 0.2,
      optionType: "call",
    });
    const df = Math.exp(-0.05);
    expect(g.delta).toBeGreaterThan(0);
    expect(g.delta).toBeLessThanOrEqual(df + 1e-9);
    expect(g.vega).toBeGreaterThan(0);
  });
});
