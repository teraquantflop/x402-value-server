import { describe, expect, it } from "vitest";
import {
  portfolioGreeksInputSchema,
  portfolioScenarioInputSchema,
} from "../src/schemas/portfolio.js";

const position = {
  underlying: 100,
  strike: 100,
  timeToExpiry: 1,
  optionType: "call" as const,
  quantity: 1,
  volatility: 0.2,
};

describe("portfolioGreeksInputSchema", () => {
  it("accepts multi-leg book", () => {
    const r = portfolioGreeksInputSchema.safeParse({
      rate: 0.05,
      positions: [position, { ...position, quantity: -2, optionType: "put" }],
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.dividendYield).toBe(0);
      expect(r.data.includeDollarGreeks).toBe(false);
    }
  });

  it("rejects zero quantity", () => {
    const r = portfolioGreeksInputSchema.safeParse({
      rate: 0.05,
      positions: [{ ...position, quantity: 0 }],
    });
    expect(r.success).toBe(false);
  });

  it("rejects empty positions", () => {
    const r = portfolioGreeksInputSchema.safeParse({
      rate: 0.05,
      positions: [],
    });
    expect(r.success).toBe(false);
  });
});

describe("portfolioScenarioInputSchema", () => {
  it("accepts scenarios with defaults", () => {
    const r = portfolioScenarioInputSchema.safeParse({
      rate: 0.05,
      positions: [position],
      scenarios: [{ name: "s1" }],
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.scenarios[0]!.spotShock).toBe(0);
      expect(r.data.scenarios[0]!.volShock).toBe(0);
      expect(r.data.scenarios[0]!.timeDecayDays).toBe(0);
    }
  });

  it("rejects empty scenarios", () => {
    const r = portfolioScenarioInputSchema.safeParse({
      rate: 0.05,
      positions: [position],
      scenarios: [],
    });
    expect(r.success).toBe(false);
  });
});
