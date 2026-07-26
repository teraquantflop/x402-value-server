import { describe, expect, it } from "vitest";
import {
  aggregatePortfolio,
  runPortfolioScenarios,
  shockPosition,
  type PortfolioPosition,
} from "../src/services/portfolio.js";
import { priceOption, computeGreeks } from "../src/services/blackScholes.js";

const LONG_CALL: PortfolioPosition = {
  underlying: 100,
  strike: 100,
  timeToExpiry: 1,
  optionType: "call",
  quantity: 10,
  volatility: 0.2,
};

const SHORT_PUT: PortfolioPosition = {
  underlying: 100,
  strike: 110,
  timeToExpiry: 1,
  optionType: "put",
  quantity: -5,
  volatility: 0.22,
};

describe("aggregatePortfolio", () => {
  it("matches single-leg BSM scaled by quantity", () => {
    const snap = aggregatePortfolio(0.05, 0, [LONG_CALL], false);
    const unit = {
      spot: 100,
      strike: 100,
      timeToExpiry: 1,
      rate: 0.05,
      dividendYield: 0,
      optionType: "call" as const,
      volatility: 0.2,
    };
    const price = priceOption(unit);
    const g = computeGreeks(unit);

    expect(snap.mtm).toBeCloseTo(price * 10, 6);
    expect(snap.greeks.delta).toBeCloseTo(g.delta * 10, 6);
    expect(snap.greeks.vega).toBeCloseTo(g.vega * 10, 6);
    expect(snap.legs).toHaveLength(1);
    expect(snap.legs[0]!.contribution).toBeCloseTo(price * 10, 6);
  });

  it("nets long and short legs", () => {
    const snap = aggregatePortfolio(0.05, 0, [LONG_CALL, SHORT_PUT], true);
    expect(snap.legs).toHaveLength(2);
    expect(snap.mtm).toBeCloseTo(47.16439511, 5);
    expect(snap.greeks.delta).toBeCloseTo(9.05941615, 5);
    expect(snap.dollarGreeks).toBeDefined();
    expect(snap.dollarGreeks!.deltaCash).toBeCloseTo(905.941615, 4);
  });

  it("omits dollar Greeks by default", () => {
    const snap = aggregatePortfolio(0.05, 0, [LONG_CALL], false);
    expect(snap.dollarGreeks).toBeUndefined();
  });
});

describe("shockPosition", () => {
  it("applies relative spot and vol shocks and time decay", () => {
    const shocked = shockPosition(LONG_CALL, {
      spotShock: -0.1,
      volShock: 0.2,
      timeDecayDays: 365,
    });
    expect(shocked.underlying).toBeCloseTo(90, 10);
    expect(shocked.volatility).toBeCloseTo(0.24, 10);
    expect(shocked.timeToExpiry).toBeCloseTo(0, 10);
  });

  it("clamps vol and time to non-negative floors", () => {
    const shocked = shockPosition(LONG_CALL, {
      volShock: -0.999999,
      timeDecayDays: 10_000,
    });
    expect(shocked.volatility).toBeGreaterThan(0);
    expect(shocked.timeToExpiry).toBe(0);
  });
});

describe("runPortfolioScenarios", () => {
  it("returns base + per-scenario mtmChange", () => {
    const result = runPortfolioScenarios(0.05, 0, [LONG_CALL, SHORT_PUT], [
      { name: "spot_down_10", spotShock: -0.1 },
      { name: "flat", spotShock: 0, volShock: 0, timeDecayDays: 0 },
    ]);

    expect(result.base.mtm).toBeCloseTo(47.16439511, 5);
    expect(result.scenarios).toHaveLength(2);
    expect(result.scenarios[0]!.name).toBe("spot_down_10");
    expect(result.scenarios[0]!.mtmChange).toBeCloseTo(
      result.scenarios[0]!.mtm - result.base.mtm,
      8,
    );
    expect(result.scenarios[1]!.mtmChange).toBeCloseTo(0, 6);
    expect(result.scenarios[1]!.greeks.delta).toBeCloseTo(
      result.base.greeks.delta,
      6,
    );
  });

  it("supports single-option portfolios", () => {
    const result = runPortfolioScenarios(0.05, 0, [LONG_CALL], [
      { name: "vol_up", volShock: 0.1 },
    ]);
    expect(result.scenarios[0]!.mtm).toBeGreaterThan(result.base.mtm);
  });

  it("names unnamed scenarios", () => {
    const result = runPortfolioScenarios(0.05, 0, [LONG_CALL], [{}]);
    expect(result.scenarios[0]!.name).toBe("scenario_0");
  });
});
