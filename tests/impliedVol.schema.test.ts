import { describe, expect, it } from "vitest";
import { impliedVolInputSchema } from "../src/schemas/impliedVol.js";

describe("impliedVolInputSchema", () => {
  const valid = {
    underlying: 100,
    strike: 100,
    timeToExpiry: 1,
    rate: 0.05,
    optionType: "call" as const,
    premium: 10.45,
  };

  it("accepts valid payload and defaults dividendYield", () => {
    const r = impliedVolInputSchema.safeParse(valid);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.dividendYield).toBe(0);
  });

  it("rejects zero premium is ok (non-negative)", () => {
    const r = impliedVolInputSchema.safeParse({ ...valid, premium: 0 });
    expect(r.success).toBe(true);
  });

  it("rejects negative premium", () => {
    const r = impliedVolInputSchema.safeParse({ ...valid, premium: -1 });
    expect(r.success).toBe(false);
  });

  it("rejects unknown fields", () => {
    const r = impliedVolInputSchema.safeParse({ ...valid, volatility: 0.2 });
    expect(r.success).toBe(false);
  });
});
