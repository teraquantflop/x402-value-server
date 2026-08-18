import { describe, expect, it } from "vitest";
import type { AppConfig } from "../src/types.js";
import {
  buildServiceCard,
  buildWellKnownX402,
} from "../src/discovery/catalog.js";
import { buildPaidRoutes } from "../src/x402/routeConfig.js";
import { NETWORK_MAP, payToForNetwork } from "../src/config.js";

const SOLANA_PAYTO = "DCi9X5mmacNGLeJvCw9fdWgX3G8V4QquDn4EuXATkcYr";
const BASE_PAYTO =
  "0x34cfb8bdbf16e4484b7da0ed31deed5771b16c8f" as `0x${string}`;

function dualMainnetConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    port: 4021,
    nodeEnv: "test",
    payToAddress: SOLANA_PAYTO,
    payToEvm: BASE_PAYTO,
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
    networks: ["solana", "base"],
    networkIds: [NETWORK_MAP.solana, NETWORK_MAP.base],
    facilitatorUrl: "https://facilitator.payai.network",
    publicBaseUrl: "https://example.test",
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
    mcpEnabled: true,
    mcpPath: "/mcp",
    cdpConfigured: false,
    serviceName: "x402-derivatives-desk",
    serviceVersion: "1.5.0",
    ...overrides,
  };
}

describe("dual Solana + Base settlement discovery", () => {
  const config = dualMainnetConfig();

  it("payToForNetwork returns family-specific receivers", () => {
    expect(payToForNetwork(config, NETWORK_MAP.solana)).toBe(SOLANA_PAYTO);
    expect(payToForNetwork(config, NETWORK_MAP.base).toLowerCase()).toBe(
      BASE_PAYTO.toLowerCase(),
    );
  });

  it("service card lists both networks without payTo wallets", () => {
    const card = buildServiceCard(config);
    expect(card.settlement.networks).toHaveLength(2);

    const sol = card.settlement.networks.find((n) => n.alias === "solana");
    const base = card.settlement.networks.find((n) => n.alias === "base");
    expect(sol?.caip2).toBe(NETWORK_MAP.solana);
    expect((sol as { payTo?: string })?.payTo).toBeUndefined();
    expect(sol?.asset).toBe("USDC");
    expect(sol?.scheme).toBe("exact");

    expect(base?.caip2).toBe(NETWORK_MAP.base);
    expect((base as { payTo?: string })?.payTo).toBeUndefined();
    expect(base?.asset).toBe("USDC");
    expect(base?.scheme).toBe("exact");

    expect(card.settlement.facilitators.payai).toBe(true);
    expect(card.settlement.facilitators.base).toMatch(/cdp|payai/);
  });

  it("well-known inherits dual settlement without wallets", () => {
    const doc = buildWellKnownX402(config);
    expect(doc.settlement.networks).toHaveLength(2);
    expect((doc.settlement as { payTo?: string }).payTo).toBeUndefined();
    for (const n of doc.settlement.networks) {
      expect((n as { payTo?: string }).payTo).toBeUndefined();
      expect(n.asset).toBe("USDC");
      expect(n.scheme).toBe("exact");
    }
  });

  it("buildPaidRoutes emits accepts for both networks on every paid path", () => {
    const routes = buildPaidRoutes(config);
    const keys = Object.keys(routes);
    expect(keys.length).toBeGreaterThanOrEqual(5);

    for (const key of keys) {
      const route = routes[key as keyof typeof routes];
      expect(route.accepts).toHaveLength(2);

      const networks = route.accepts.map((a) => a.network);
      expect(networks).toContain(NETWORK_MAP.solana);
      expect(networks).toContain(NETWORK_MAP.base);

      for (const a of route.accepts) {
        expect(a.scheme).toBe("exact");
        expect(a.price).toMatch(/^\$/);
        if (a.network === NETWORK_MAP.solana) {
          expect(a.payTo).toBe(SOLANA_PAYTO);
        }
        if (a.network === NETWORK_MAP.base) {
          expect(String(a.payTo).toLowerCase()).toBe(BASE_PAYTO.toLowerCase());
        }
      }
    }
  });

  it("uses multi-chain Bazaar settlement tag when both families enabled", () => {
    const card = buildServiceCard(config);
    const tags = card.endpoints.paid[0]!.tags;
    expect(tags).toContain("multi-chain");
    expect(tags).not.toContain("solana");
  });
});
