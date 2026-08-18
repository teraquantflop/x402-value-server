import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Server } from "node:http";
import type { Express } from "express";
import {
  SURFACE_PRICE_EXAMPLE_INPUT,
  SURFACE_SCENARIO_EXAMPLE_INPUT,
} from "../src/schemas/surfacePricing.js";

const PAY_TO = "0x1111111111111111111111111111111111111111";

async function listen(app: Express): Promise<{ server: Server; baseUrl: string }> {
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no address");
  return { server, baseUrl: `http://127.0.0.1:${addr.port}` };
}

describe("surface pricing HTTP", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    vi.resetModules();
    delete process.env.SKIP_PAYMENT;
    process.env.NODE_ENV = "test";
    process.env.PAY_TO_ADDRESS = PAY_TO;
    process.env.NETWORKS = "base-sepolia";
    process.env.FACILITATOR_URL = "https://x402.org/facilitator";
    process.env.FREE_TIER_N = "0";
    const { createApp } = await import("../src/app.js");
    ({ server, baseUrl } = await listen(createApp()));
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it("unpaid price-from-surface returns 402", async () => {
    const res = await fetch(`${baseUrl}/v1/option/price-from-surface`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(SURFACE_PRICE_EXAMPLE_INPUT),
    });
    expect(res.status).toBe(402);
  });

  it("unpaid scenario-from-surface returns 402", async () => {
    const res = await fetch(`${baseUrl}/v1/option/scenario-from-surface`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(SURFACE_SCENARIO_EXAMPLE_INPUT),
    });
    expect(res.status).toBe(402);
  });
});

describe("surface pricing compute (SKIP_PAYMENT)", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    vi.resetModules();
    process.env.SKIP_PAYMENT = "1";
    process.env.NODE_ENV = "test";
    process.env.PAY_TO_ADDRESS = PAY_TO;
    process.env.NETWORKS = "base-sepolia";
    process.env.FREE_TIER_N = "0";
    const { createApp } = await import("../src/app.js");
    ({ server, baseUrl } = await listen(createApp()));
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    delete process.env.SKIP_PAYMENT;
  });

  it("price-from-surface returns results", async () => {
    const res = await fetch(`${baseUrl}/v1/option/price-from-surface`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(SURFACE_PRICE_EXAMPLE_INPUT),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      results: { impliedVol: number; price: number }[];
    };
    expect(body.results[0]!.impliedVol).toBeCloseTo(0.2, 3);
    expect(body.results[0]!.price).toBeGreaterThan(0);
  });

  it("rejects duplicate surface points with 400", async () => {
    const res = await fetch(`${baseUrl}/v1/option/price-from-surface`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...SURFACE_PRICE_EXAMPLE_INPUT,
        surface: [
          { k: 0, timeToExpiry: 1, iv: 0.2 },
          { k: 0, timeToExpiry: 1, iv: 0.21 },
        ],
      }),
    });
    expect(res.status).toBe(400);
  });

  it("scenario-from-surface returns base vs scenario", async () => {
    const res = await fetch(`${baseUrl}/v1/option/scenario-from-surface`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(SURFACE_SCENARIO_EXAMPLE_INPUT),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      book: { valueBase: number; valueScenario: number; deltaValue: number };
      sticky: string;
    };
    expect(body.sticky).toBe("moneyness");
    expect(body.book.valueScenario).toBeGreaterThan(body.book.valueBase);
    expect(body.book.deltaValue).toBeCloseTo(
      body.book.valueScenario - body.book.valueBase,
      6,
    );
  });

  it("rejects dual underlying shocks with 400", async () => {
    const res = await fetch(`${baseUrl}/v1/option/scenario-from-surface`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...SURFACE_SCENARIO_EXAMPLE_INPUT,
        scenario: { underlyingRel: 0.1, underlyingAbs: 5 },
      }),
    });
    expect(res.status).toBe(400);
  });
});
