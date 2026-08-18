/**
 * HTTP tests for the three new paid endpoints.
 * Uses module reset + SKIP_PAYMENT so handlers return 200 for the compute path,
 * then a separate suite without skip for the unpaid 402 challenge.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Server } from "node:http";
import type { Express } from "express";

const PAY_TO = "0x1111111111111111111111111111111111111111";

async function listen(app: Express): Promise<{ server: Server; baseUrl: string }> {
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no address");
  return { server, baseUrl: `http://127.0.0.1:${addr.port}` };
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

describe("new paid endpoints (SKIP_PAYMENT compute path)", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    vi.resetModules();
    process.env.SKIP_PAYMENT = "1";
    process.env.NODE_ENV = "test";
    process.env.PAY_TO_ADDRESS = PAY_TO;
    process.env.NETWORKS = "base-sepolia";
    process.env.FACILITATOR_URL =
      process.env.FACILITATOR_URL ?? "https://x402.org/facilitator";

    const { createApp } = await import("../src/app.js");
    const app = createApp();
    ({ server, baseUrl } = await listen(app));
  });

  afterAll(async () => {
    await closeServer(server);
    delete process.env.SKIP_PAYMENT;
  });

  it("POST /v1/option/implied-vol returns IV + Greeks", async () => {
    const res = await fetch(`${baseUrl}/v1/option/implied-vol`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        underlying: 100,
        strike: 100,
        timeToExpiry: 1,
        rate: 0.05,
        dividendYield: 0,
        optionType: "call",
        premium: 10.45057562,
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      impliedVol: number;
      greeks: { delta: number };
      modelPrice: number;
      converged: boolean;
      requestId: string;
      computedAt: string;
    };
    expect(body.converged).toBe(true);
    expect(body.impliedVol).toBeCloseTo(0.2, 3);
    expect(body.greeks.delta).toBeCloseTo(0.6368, 3);
    expect(body.modelPrice).toBeCloseTo(10.45057562, 4);
    expect(body.requestId).toBeTruthy();
    expect(body.computedAt).toBeTruthy();
  });

  it("POST /v1/option/implied-vol validates body", async () => {
    const res = await fetch(`${baseUrl}/v1/option/implied-vol`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ underlying: 100 }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /v1/portfolio/greeks aggregates multi-leg book", async () => {
    const res = await fetch(`${baseUrl}/v1/portfolio/greeks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rate: 0.05,
        dividendYield: 0,
        includeDollarGreeks: true,
        positions: [
          {
            underlying: 100,
            strike: 100,
            timeToExpiry: 1,
            optionType: "call",
            quantity: 10,
            volatility: 0.2,
          },
          {
            underlying: 100,
            strike: 110,
            timeToExpiry: 1,
            optionType: "put",
            quantity: -5,
            volatility: 0.22,
          },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      net: { mtm: number; greeks: { delta: number }; dollarGreeks?: unknown };
      positionCount: number;
      legs: unknown[];
    };
    expect(body.positionCount).toBe(2);
    expect(body.legs).toHaveLength(2);
    expect(body.net.mtm).toBeCloseTo(47.16439511, 4);
    expect(body.net.greeks.delta).toBeCloseTo(9.05941615, 4);
    expect(body.net.dollarGreeks).toBeDefined();
  });

  it("POST /v1/portfolio/scenario returns base + shocks", async () => {
    const res = await fetch(`${baseUrl}/v1/portfolio/scenario`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rate: 0.05,
        positions: [
          {
            underlying: 100,
            strike: 100,
            timeToExpiry: 1,
            optionType: "call",
            quantity: 1,
            volatility: 0.2,
          },
        ],
        scenarios: [
          { name: "spot_up", spotShock: 0.05 },
          { name: "vol_up", volShock: 0.1 },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      base: { mtm: number; greeks: { delta: number } };
      scenarios: {
        name: string;
        mtm: number;
        mtmChange: number;
        greeks: unknown;
      }[];
      scenarioCount: number;
      positionCount: number;
    };
    expect(body.positionCount).toBe(1);
    expect(body.scenarioCount).toBe(2);
    expect(body.scenarios).toHaveLength(2);
    expect(body.scenarios[0]!.name).toBe("spot_up");
    expect(body.scenarios[0]!.mtm).toBeGreaterThan(body.base.mtm);
    expect(body.scenarios[0]!.mtmChange).toBeCloseTo(
      body.scenarios[0]!.mtm - body.base.mtm,
      8,
    );
    expect(body.scenarios[1]!.greeks).toBeDefined();
  });

  it("GET /health lists new prices", async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      prices: Record<string, string>;
    };
    expect(body.prices.impliedVol).toMatch(/^\$/);
    expect(body.prices.portfolioGreeks).toMatch(/^\$/);
    expect(body.prices.portfolioScenario).toMatch(/^\$/);
    expect(body.prices.optionFromSurface).toMatch(/^\$/);
    expect(body.prices.scenarioFromSurface).toMatch(/^\$/);
  });

  it("GET / service card includes paid endpoints", async () => {
    const res = await fetch(`${baseUrl}/`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      endpoints: { paid: { path: string }[] };
      examples: Record<string, unknown>;
    };
    const paths = body.endpoints.paid.map((p) => p.path);
    expect(paths).toContain("/v1/option/implied-vol");
    expect(paths).toContain("/v1/portfolio/greeks");
    expect(paths).toContain("/v1/portfolio/scenario");
    expect(paths).toContain("/v1/option/price-from-surface");
    expect(paths).toContain("/v1/option/scenario-from-surface");
    expect(body.examples.impliedVol).toBeDefined();
    expect(body.examples.portfolioGreeks).toBeDefined();
    expect(body.examples.portfolioScenario).toBeDefined();
    expect(body.examples.optionFromSurface).toBeDefined();
    expect(body.examples.scenarioFromSurface).toBeDefined();
  });

  it("well-known lists all paid resources", async () => {
    const res = await fetch(`${baseUrl}/.well-known/x402.json`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      resources: { path: string; price: string }[];
    };
    const paths = body.resources.map((r) => r.path);
    expect(paths).toContain("/v1/option/implied-vol");
    expect(paths).toContain("/v1/portfolio/greeks");
    expect(paths).toContain("/v1/portfolio/scenario");
    expect(paths).toContain("/v1/option/price-from-surface");
    expect(paths).toContain("/v1/option/scenario-from-surface");
    expect(body.resources.length).toBeGreaterThanOrEqual(7);
  });
});

describe("new paid endpoints unpaid 402 path", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    vi.resetModules();
    delete process.env.SKIP_PAYMENT;
    process.env.NODE_ENV = "test";
    process.env.PAY_TO_ADDRESS = PAY_TO;
    process.env.NETWORKS = "base-sepolia";
    process.env.FACILITATOR_URL =
      process.env.FACILITATOR_URL ?? "https://x402.org/facilitator";

    const { createApp } = await import("../src/app.js");
    const app = createApp();
    ({ server, baseUrl } = await listen(app));
  });

  afterAll(async () => {
    await closeServer(server);
  });

  it.each([
    "/v1/option/implied-vol",
    "/v1/portfolio/greeks",
    "/v1/portfolio/scenario",
  ])("unpaid POST %s returns 402", async (path) => {
    const bodies: Record<string, unknown> = {
      "/v1/option/implied-vol": {
        underlying: 100,
        strike: 100,
        timeToExpiry: 1,
        rate: 0.05,
        optionType: "call",
        premium: 10,
      },
      "/v1/portfolio/greeks": {
        rate: 0.05,
        positions: [
          {
            underlying: 100,
            strike: 100,
            timeToExpiry: 1,
            optionType: "call",
            quantity: 1,
            volatility: 0.2,
          },
        ],
      },
      "/v1/portfolio/scenario": {
        rate: 0.05,
        positions: [
          {
            underlying: 100,
            strike: 100,
            timeToExpiry: 1,
            optionType: "call",
            quantity: 1,
            volatility: 0.2,
          },
        ],
        scenarios: [{ name: "s", spotShock: 0.01 }],
      },
    };

    const res = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bodies[path]),
    });
    expect(res.status).toBe(402);
    // Primary terms live in PAYMENT-REQUIRED (header name casing may vary)
    const headerKeys = [...res.headers.keys()].map((k) => k.toLowerCase());
    expect(
      headerKeys.some(
        (k) => k.includes("payment-required") || k.includes("x-payment"),
      ),
    ).toBe(true);
  });
});
