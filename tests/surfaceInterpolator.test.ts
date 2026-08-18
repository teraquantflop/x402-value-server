import { describe, expect, it } from "vitest";
import { priceOption } from "../src/services/blackScholes.js";
import {
  buildSurfaceGrid,
  interpolateVol,
  logMoneyness,
  normalizeSurfacePoints,
  SurfaceValidationError,
} from "../src/services/surfaceInterpolator.js";
import { priceFromSurface } from "../src/services/priceFromSurface.js";
import { scenarioFromSurface } from "../src/services/scenarioFromSurface.js";

/** 3×3 smile: ATM 0.20; put wing higher; call wing higher. */
const SMILE_3X3 = [
  { k: -0.1, timeToExpiry: 0.25, iv: 0.22 },
  { k: 0, timeToExpiry: 0.25, iv: 0.2 },
  { k: 0.1, timeToExpiry: 0.25, iv: 0.23 },
  { k: -0.1, timeToExpiry: 0.5, iv: 0.21 },
  { k: 0, timeToExpiry: 0.5, iv: 0.2 },
  { k: 0.1, timeToExpiry: 0.5, iv: 0.22 },
  { k: -0.1, timeToExpiry: 1, iv: 0.205 },
  { k: 0, timeToExpiry: 1, iv: 0.2 },
  { k: 0.1, timeToExpiry: 1, iv: 0.215 },
];

describe("normalizeSurfacePoints", () => {
  it("converts strike form to k", () => {
    const pts = normalizeSurfacePoints([
      { strike: 100, underlying: 100, timeToExpiry: 1, iv: 0.2 },
    ]);
    expect(pts[0]!.k).toBeCloseTo(0, 12);
  });

  it("rejects duplicate (k,T)", () => {
    expect(() =>
      normalizeSurfacePoints([
        { k: 0, timeToExpiry: 1, iv: 0.2 },
        { k: 0, timeToExpiry: 1, iv: 0.21 },
      ]),
    ).toThrow(SurfaceValidationError);
  });
});

describe("interpolateVol", () => {
  const grid = buildSurfaceGrid(normalizeSurfacePoints(SMILE_3X3));

  it("ATM at T=1 returns 0.20", () => {
    const { sigma } = interpolateVol(grid, 0, 1);
    expect(sigma).toBeCloseTo(0.2, 5);
  });

  it("OTM call wing uses higher σ than ATM", () => {
    const atm = interpolateVol(grid, 0, 1).sigma;
    const otm = interpolateVol(grid, 0.1, 1).sigma;
    expect(otm).toBeGreaterThan(atm);
  });
});

describe("priceFromSurface", () => {
  it("ATM matches scalar BS at σ=0.20", () => {
    const result = priceFromSurface(
      {
        rate: 0.05,
        dividendYield: 0,
        surface: SMILE_3X3,
        options: [
          {
            underlying: 100,
            strike: 100,
            timeToExpiry: 1,
            optionType: "call",
            quantity: 1,
          },
        ],
      },
      "t",
    );
    const scalar = priceOption({
      spot: 100,
      strike: 100,
      timeToExpiry: 1,
      rate: 0.05,
      dividendYield: 0,
      optionType: "call",
      volatility: 0.2,
    });
    expect(result.results[0]!.impliedVol).toBeCloseTo(0.2, 4);
    expect(result.results[0]!.price).toBeCloseTo(scalar, 4);
  });

  it("OTM uses wing vol ≠ ATM", () => {
    const F = 100;
    const K = F * Math.exp(0.1);
    const result = priceFromSurface(
      {
        rate: 0.05,
        dividendYield: 0,
        surface: SMILE_3X3,
        options: [
          {
            underlying: F,
            strike: K,
            timeToExpiry: 1,
            optionType: "call",
            quantity: 1,
          },
        ],
      },
      "t",
    );
    expect(result.results[0]!.impliedVol).toBeGreaterThan(0.2);
  });
});

describe("scenarioFromSurface sticky", () => {
  const baseInput = {
    rate: 0.05,
    dividendYield: 0,
    surface: SMILE_3X3,
    positions: [
      {
        underlying: 100,
        strike: 100,
        timeToExpiry: 1,
        optionType: "call" as const,
        quantity: 1,
      },
    ],
    scenario: { underlyingRel: 0.1 },
  };

  it("moneyness vs strike vs fixed_vol differ under +10% F + time roll (OTM)", () => {
    // F-only: strike sticky ≡ fixed_vol at same T (both read/freeze base k).
    // Add timeDays so strike re-interps at new T while fixed_vol freezes base node.
    const F = 100;
    const K = F * Math.exp(0.1);
    const otm = {
      rate: 0.05,
      dividendYield: 0,
      surface: SMILE_3X3,
      positions: [
        {
          underlying: F,
          strike: K,
          timeToExpiry: 1,
          optionType: "call" as const,
          quantity: 1,
        },
      ],
      scenario: { underlyingRel: 0.1, timeDays: 90 },
    };
    const m = scenarioFromSurface({ ...otm, sticky: "moneyness" }, "t");
    const s = scenarioFromSurface({ ...otm, sticky: "strike" }, "t");
    const f = scenarioFromSurface({ ...otm, sticky: "fixed_vol" }, "t");
    const sigmas = [
      m.legs[0]!.scenario.impliedVol,
      s.legs[0]!.scenario.impliedVol,
      f.legs[0]!.scenario.impliedVol,
    ];
    expect(new Set(sigmas.map((p) => p.toFixed(6))).size).toBe(3);
  });

  it("volAbs increases call value", () => {
    const base = scenarioFromSurface(
      { ...baseInput, sticky: "moneyness", scenario: {} },
      "t",
    );
    const up = scenarioFromSurface(
      { ...baseInput, sticky: "moneyness", scenario: { volAbs: 0.05 } },
      "t",
    );
    expect(up.book.valueScenario).toBeGreaterThan(base.book.valueScenario);
  });

  it("volRel increases call value", () => {
    const base = scenarioFromSurface(
      { ...baseInput, sticky: "fixed_vol", scenario: {} },
      "t",
    );
    const up = scenarioFromSurface(
      { ...baseInput, sticky: "fixed_vol", scenario: { volRel: 0.2 } },
      "t",
    );
    expect(up.book.valueScenario).toBeGreaterThan(base.book.valueScenario);
  });

  it("smileTwist moves OTM value", () => {
    const F = 100;
    const K = F * Math.exp(0.1);
    const pos = [
      {
        underlying: F,
        strike: K,
        timeToExpiry: 1,
        optionType: "call" as const,
        quantity: 1,
      },
    ];
    const base = scenarioFromSurface(
      {
        rate: 0.05,
        dividendYield: 0,
        surface: SMILE_3X3,
        sticky: "moneyness",
        positions: pos,
        scenario: {},
      },
      "t",
    );
    const twisted = scenarioFromSurface(
      {
        rate: 0.05,
        dividendYield: 0,
        surface: SMILE_3X3,
        sticky: "moneyness",
        positions: pos,
        scenario: { smileTwist: 0.5 },
      },
      "t",
    );
    expect(twisted.legs[0]!.scenario.impliedVol).toBeGreaterThan(
      base.legs[0]!.scenario.impliedVol,
    );
  });

  it("timeDays reduces T and changes value", () => {
    const base = scenarioFromSurface(
      { ...baseInput, sticky: "moneyness", scenario: {} },
      "t",
    );
    const decay = scenarioFromSurface(
      { ...baseInput, sticky: "moneyness", scenario: { timeDays: 30 } },
      "t",
    );
    expect(decay.legs[0]!.scenario.timeToExpiry).toBeLessThan(1);
    expect(decay.book.valueScenario).not.toBe(base.book.valueScenario);
  });

  it("rejects dual underlying shocks", () => {
    expect(() =>
      scenarioFromSurface(
        {
          ...baseInput,
          scenario: { underlyingRel: 0.1, underlyingAbs: 5 },
        },
        "t",
      ),
    ).toThrow(/underlyingRel|underlyingAbs/);
  });
});

describe("logMoneyness", () => {
  it("ATM is zero", () => {
    expect(logMoneyness(100, 100)).toBeCloseTo(0, 12);
  });
});
