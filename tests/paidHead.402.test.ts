/**
 * HEAD on paid paths must return x402 402 (not Express 404) for uptime monitors.
 * No pricing / settle — unpaid challenge only.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Server } from "node:http";
import type { Express } from "express";
import {
  buildPaidRoutes,
  paidPostPaths,
  withHeadChallenges,
} from "../src/x402/routeConfig.js";
import type { AppConfig } from "../src/types.js";
import { NETWORK_MAP } from "../src/config.js";

const SOLANA_PAYTO = "DCi9X5mmacNGLeJvCw9fdWgX3G8V4QquDn4EuXATkcYr";

function paymentRequiredHeader(res: Response): string | null {
  return (
    res.headers.get("PAYMENT-REQUIRED") ??
    res.headers.get("payment-required") ??
    res.headers.get("Payment-Required")
  );
}

async function listen(app: Express): Promise<{ server: Server; baseUrl: string }> {
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no address");
  return { server, baseUrl: `http://127.0.0.1:${addr.port}` };
}

describe("withHeadChallenges unit", () => {
  it("clones every POST key to HEAD with same accepts", () => {
    const cfg = {
      port: 4021,
      nodeEnv: "test",
      payToAddress: SOLANA_PAYTO,
      payToSvm: SOLANA_PAYTO,
      priceUsd: 0.01,
      priceDollarString: "$0.01",
      priceVolSurfaceUsd: 0.1,
      priceVolSurfaceDollarString: "$0.10",
      priceImpliedVolUsd: 0.03,
      priceImpliedVolDollarString: "$0.03",
      pricePortfolioGreeksUsd: 0.15,
      pricePortfolioGreeksDollarString: "$0.15",
      pricePortfolioScenarioUsd: 0.25,
      pricePortfolioScenarioDollarString: "$0.25",
      priceOptionFromSurfaceUsd: 0.08,
      priceOptionFromSurfaceDollarString: "$0.08",
      priceScenarioFromSurfaceUsd: 0.15,
      priceScenarioFromSurfaceDollarString: "$0.15",
      maxSurfaceOptions: 200,
      maxSurfacePoints: 200,
      maxSurfacePriceOptions: 50,
      maxPortfolioPositions: 100,
      maxScenarios: 20,
      networks: ["solana"] as AppConfig["networks"],
      networkIds: [NETWORK_MAP.solana],
      facilitatorUrl: "https://facilitator.payai.network",
      publicBaseUrl: "http://localhost:4021",
      corsOrigin: "*",
      rateLimitWindowMs: 60_000,
      rateLimitMax: 60,
      idempotencyTtlMs: 300_000,
      trustProxy: false,
      skipPayment: false,
      freeDemoEnabled: true,
      freeDemoRateMax: 30,
      freeTierN: 0,
      freeTierWindowMs: 86_400_000,
      mcpEnabled: false,
      mcpPath: "/mcp",
      cdpConfigured: false,
      serviceName: "x402-derivatives-desk",
      serviceVersion: "1.6.0",
    } satisfies AppConfig;

    const post = buildPaidRoutes(cfg, { cdpEnabled: false });
    const paths = paidPostPaths(post);
    expect(paths.length).toBeGreaterThanOrEqual(7);
    expect(paths).toContain("/v1/option/price");
    expect(paths).toContain("/v1/volatility/surface");
    expect(paths).toContain("/v1/portfolio/scenario");

    const both = withHeadChallenges(post);
    for (const p of paths) {
      const head = both[`HEAD ${p}`] as {
        accepts: unknown[];
        extensions?: unknown;
      };
      const postCfg = post[`POST ${p}` as keyof typeof post] as {
        accepts: unknown[];
      };
      expect(head.accepts).toEqual(postCfg.accepts);
      expect(head.extensions).toBeUndefined();
    }
  });
});

describe("HEAD paid routes → 402 (HTTP)", () => {
  let server: Server;
  let baseUrl: string;
  let paidPaths: string[];

  beforeAll(async () => {
    vi.resetModules();
    delete process.env.SKIP_PAYMENT;
    process.env.NODE_ENV = "test";
    process.env.NETWORKS = "solana";
    process.env.PAY_TO_ADDRESS = SOLANA_PAYTO;
    process.env.PAY_TO_SVM_ADDRESS = SOLANA_PAYTO;
    process.env.FACILITATOR_URL = "https://facilitator.payai.network";
    process.env.PUBLIC_BASE_URL = "http://localhost:4021";
    process.env.FREE_TIER_N = "0";
    delete process.env.CDP_API_KEY_ID;
    delete process.env.CDP_API_KEY_SECRET;
    delete process.env.POLY_PAY_TO;

    const { createApp } = await import("../src/app.js");
    const { config } = await import("../src/config.js");
    paidPaths = paidPostPaths(
      buildPaidRoutes(config, { cdpEnabled: false }),
    );
    ({ server, baseUrl } = await listen(createApp()));
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it.each([
    "/v1/option/price",
    "/v1/option/implied-vol",
    "/v1/volatility/surface",
    "/v1/portfolio/greeks",
    "/v1/portfolio/scenario",
    "/v1/option/price-from-surface",
    "/v1/option/scenario-from-surface",
  ])("HEAD %s → 402 with Allow: POST and PAYMENT-REQUIRED", async (path) => {
    expect(paidPaths).toContain(path);
    const res = await fetch(`${baseUrl}${path}`, { method: "HEAD" });
    expect(res.status).toBe(402);
    const allow = res.headers.get("allow") ?? "";
    expect(allow.toUpperCase()).toContain("POST");
    expect(paymentRequiredHeader(res)).toBeTruthy();
    // HEAD should not deliver a successful price body
    const text = await res.text();
    expect(text.length).toBeLessThan(500);
    expect(text).not.toMatch(/"price"\s*:\s*\d/);
  });

  it("unpaid POST /v1/option/price still 402", async () => {
    const res = await fetch(`${baseUrl}/v1/option/price`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(402);
    expect(paymentRequiredHeader(res)).toBeTruthy();
  });

  it("GET /v1/option/price is not a 200 price response", async () => {
    const res = await fetch(`${baseUrl}/v1/option/price`, { method: "GET" });
    expect(res.status).not.toBe(200);
    if (res.status === 200) {
      const body = (await res.json()) as { price?: unknown };
      expect(body.price).toBeUndefined();
    }
  });

  it("GET /health includes uptimeHint", async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { uptimeHint?: string };
    expect(body.uptimeHint).toMatch(/HEAD/);
    expect(body.uptimeHint).toMatch(/402/);
  });
});
