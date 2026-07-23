import { describe, expect, it } from "vitest";
import { volatilitySurfaceInputSchema } from "../src/schemas/volatility.js";

describe("volatilitySurfaceInputSchema", () => {
  it("accepts shared rate/q + per-option underlying", () => {
    const r = volatilitySurfaceInputSchema.safeParse({
      rate: 0.05,
      dividendYield: 0,
      options: [
        {
          underlying: 100,
          strike: 90,
          timeToExpiry: 0.25,
          optionType: "call",
          premium: 12.5,
        },
      ],
    });
    expect(r.success).toBe(true);
  });

  it("allows different underlyings per maturity", () => {
    const r = volatilitySurfaceInputSchema.safeParse({
      rate: 0.05,
      options: [
        {
          underlying: 100,
          strike: 90,
          timeToExpiry: 0.25,
          optionType: "call",
          premium: 12.5,
        },
        {
          underlying: 102,
          strike: 100,
          timeToExpiry: 0.5,
          optionType: "call",
          premium: 8.7,
        },
      ],
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.options[0]!.underlying).toBe(100);
      expect(r.data.options[1]!.underlying).toBe(102);
    }
  });

  it("defaults dividendYield to 0", () => {
    const r = volatilitySurfaceInputSchema.safeParse({
      rate: 0.05,
      options: [
        {
          underlying: 100,
          strike: 100,
          timeToExpiry: 1,
          optionType: "put",
          premium: 5,
        },
      ],
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.dividendYield).toBe(0);
  });

  it("rejects empty options", () => {
    const r = volatilitySurfaceInputSchema.safeParse({
      rate: 0.05,
      options: [],
    });
    expect(r.success).toBe(false);
  });

  it("rejects top-level spot (use per-option underlying)", () => {
    const r = volatilitySurfaceInputSchema.safeParse({
      spot: 100,
      rate: 0.05,
      options: [
        {
          underlying: 100,
          strike: 100,
          timeToExpiry: 1,
          optionType: "call",
          premium: 5,
        },
      ],
    });
    expect(r.success).toBe(false);
  });

  it("rejects missing underlying on option row", () => {
    const r = volatilitySurfaceInputSchema.safeParse({
      rate: 0.05,
      options: [
        {
          strike: 100,
          timeToExpiry: 1,
          optionType: "call",
          premium: 5,
        },
      ],
    });
    expect(r.success).toBe(false);
  });
});
