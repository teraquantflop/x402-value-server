import { describe, expect, it } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createDerivativesMcpServer } from "../src/mcp/server.js";
import type { AppConfig } from "../src/types.js";
import { NETWORK_MAP } from "../src/config.js";

/** Minimal stub — skipPayment path never calls resource server methods. */
const stubResourceServer = {} as import("@x402/core/server").x402ResourceServer;

function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    port: 4021,
    nodeEnv: "test",
    payToAddress: "0x1111111111111111111111111111111111111111",
    payToEvm: "0x1111111111111111111111111111111111111111",
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
    networks: ["base-sepolia"],
    networkIds: [NETWORK_MAP["base-sepolia"]],
    facilitatorUrl: "https://x402.org/facilitator",
    publicBaseUrl: "http://localhost:4021",
    corsOrigin: "*",
    rateLimitWindowMs: 60_000,
    rateLimitMax: 60,
    idempotencyTtlMs: 300_000,
    trustProxy: false,
    skipPayment: true,
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

describe("createDerivativesMcpServer (skipPayment)", () => {
  it("creates an McpServer instance with skipPayment tools", async () => {
    const server = await createDerivativesMcpServer(
      testConfig(),
      stubResourceServer,
    );
    expect(server).toBeInstanceOf(McpServer);
  });
});
