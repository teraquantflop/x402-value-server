import { describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../src/types.js";
import { facilitatorStatus, NETWORK_MAP } from "../src/config.js";
import {
  CDP_FACILITATOR_URL,
  PAYAI_DEFAULT_URL,
  buildFacilitators,
  probeFacilitatorSupport,
  resolvePayAiUrl,
  warmResourceServer,
  type BuiltFacilitators,
} from "../src/x402/facilitator.js";
import type { FacilitatorClient } from "@x402/core/server";

const SOLANA_PAYTO = "DCi9X5mmacNGLeJvCw9fdWgX3G8V4QquDn4EuXATkcYr";
const BASE_PAYTO =
  "0x34cfb8bdbf16e4484b7da0ed31deed5771b16c8f" as `0x${string}`;

function baseConfig(overrides: Partial<AppConfig> = {}): AppConfig {
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
    facilitatorUrl: PAYAI_DEFAULT_URL,
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
    mcpEnabled: false,
    mcpPath: "/mcp",
    cdpConfigured: false,
    serviceName: "x402-derivatives-desk",
    serviceVersion: "1.6.0",
    ...overrides,
  };
}

describe("resolvePayAiUrl", () => {
  it("keeps PayAI default", () => {
    expect(resolvePayAiUrl(undefined)).toBe(PAYAI_DEFAULT_URL);
    expect(resolvePayAiUrl(PAYAI_DEFAULT_URL)).toBe(PAYAI_DEFAULT_URL);
  });

  it("rejects CDP API URL and falls back to PayAI", () => {
    expect(resolvePayAiUrl(CDP_FACILITATOR_URL)).toBe(PAYAI_DEFAULT_URL);
    expect(
      resolvePayAiUrl("https://api.cdp.coinbase.com/platform/v2/x402/"),
    ).toBe(PAYAI_DEFAULT_URL);
  });
});

describe("facilitatorStatus", () => {
  it("reports nowcast-shaped labels without CDP", () => {
    const status = facilitatorStatus(baseConfig({ cdpConfigured: false }));
    expect(status).toEqual({
      payai: true,
      cdp: false,
      base: "payai",
      solana: "payai",
    });
  });

  it("reports base=cdp when CDP configured", () => {
    const status = facilitatorStatus(
      baseConfig({
        cdpConfigured: true,
        cdpApiKeyId: "id",
        cdpApiKeySecret: "secret",
      }),
    );
    expect(status).toEqual({
      payai: true,
      cdp: true,
      base: "cdp",
      solana: "payai",
    });
  });
});

describe("buildFacilitators", () => {
  it("builds PayAI-only when CDP unset", () => {
    const built = buildFacilitators(baseConfig({ cdpConfigured: false }));
    expect(built.cdp).toBeNull();
    expect(built.clients).toHaveLength(1);
    expect(built.payaiUrl).toBe(PAYAI_DEFAULT_URL);
  });

  it("never points PayAI at CDP even if facilitatorUrl is CDP", () => {
    const built = buildFacilitators(
      baseConfig({
        facilitatorUrl: CDP_FACILITATOR_URL,
        cdpConfigured: false,
      }),
    );
    expect(built.payaiUrl).toBe(PAYAI_DEFAULT_URL);
  });
});

describe("probeFacilitatorSupport", () => {
  it("never throws when CDP getSupported rejects", async () => {
    const payai: FacilitatorClient = {
      verify: vi.fn(),
      settle: vi.fn(),
      getSupported: vi.fn().mockResolvedValue({
        kinds: [{ network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", scheme: "exact", x402Version: 2 }],
      }),
    };
    const cdp: FacilitatorClient = {
      verify: vi.fn(),
      settle: vi.fn(),
      getSupported: vi.fn().mockRejectedValue(new Error("401 Unauthorized")),
    };
    const built: BuiltFacilitators = {
      clients: [cdp, payai],
      payai,
      cdp,
      payaiUrl: PAYAI_DEFAULT_URL,
    };

    const result = await probeFacilitatorSupport(built);
    expect(result.payaiOk).toBe(true);
    expect(result.cdpOk).toBe(false);
    expect(result.errors.some((e) => /401|CDP/i.test(e))).toBe(true);
  });

  it("sets cdpOk null when CDP not built", async () => {
    const payai: FacilitatorClient = {
      verify: vi.fn(),
      settle: vi.fn(),
      getSupported: vi.fn().mockResolvedValue({
        kinds: [{ network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", scheme: "exact", x402Version: 2 }],
      }),
    };
    const result = await probeFacilitatorSupport({
      clients: [payai],
      payai,
      cdp: null,
      payaiUrl: PAYAI_DEFAULT_URL,
    });
    expect(result.cdpOk).toBeNull();
    expect(result.payaiOk).toBe(true);
  });
});

describe("warmResourceServer", () => {
  it("soft-fails initialize errors", async () => {
    const result = await warmResourceServer({
      initialize: async () => {
        throw new Error("Failed to initialize: no supported payment kinds");
      },
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no supported/i);
  });

  it("returns ok on successful initialize", async () => {
    const result = await warmResourceServer({
      initialize: async () => undefined,
    });
    expect(result.ok).toBe(true);
  });
});
