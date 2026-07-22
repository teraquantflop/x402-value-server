import { describe, expect, it } from "vitest";
import { optionInputSchema } from "../src/schemas/option.js";

describe("optionInputSchema", () => {
  it("accepts valid call payload", () => {
    const r = optionInputSchema.safeParse({
      spot: 100,
      strike: 100,
      timeToExpiry: 1,
      rate: 0.05,
      volatility: 0.2,
      optionType: "call",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.dividendYield).toBe(0);
    }
  });

  it("rejects non-positive spot", () => {
    const r = optionInputSchema.safeParse({
      spot: 0,
      strike: 100,
      timeToExpiry: 1,
      rate: 0.05,
      volatility: 0.2,
      optionType: "put",
    });
    expect(r.success).toBe(false);
  });

  it("rejects unknown fields (strict)", () => {
    const r = optionInputSchema.safeParse({
      spot: 100,
      strike: 100,
      timeToExpiry: 1,
      rate: 0.05,
      volatility: 0.2,
      optionType: "call",
      extra: true,
    });
    expect(r.success).toBe(false);
  });

  it("rejects NaN / Infinity", () => {
    const r = optionInputSchema.safeParse({
      spot: Number.NaN,
      strike: 100,
      timeToExpiry: 1,
      rate: 0.05,
      volatility: 0.2,
      optionType: "call",
    });
    expect(r.success).toBe(false);
  });

  it("allows T=0", () => {
    const r = optionInputSchema.safeParse({
      spot: 100,
      strike: 100,
      timeToExpiry: 0,
      rate: 0.05,
      volatility: 0.2,
      optionType: "call",
    });
    expect(r.success).toBe(true);
  });
});
