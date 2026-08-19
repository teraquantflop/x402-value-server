import { describe, expect, it } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  createDerivativesMcpServer,
  MCP_ALL_TOOL_NAMES,
  MCP_PAID_TOOL_NAMES,
} from "../src/mcp/server.js";
import type { AppConfig } from "../src/types.js";
import { NETWORK_MAP } from "../src/config.js";
import { priceWithGreeks } from "../src/services/blackScholes.js";
import { solveImpliedVol } from "../src/services/impliedVol.js";
import { buildVolatilitySurface } from "../src/services/volatilitySurface.js";
import { aggregatePortfolio, runPortfolioScenarios } from "../src/services/portfolio.js";
import { priceFromSurface } from "../src/services/priceFromSurface.js";
import { scenarioFromSurface } from "../src/services/scenarioFromSurface.js";
import { OPTION_EXAMPLE_INPUT } from "../src/schemas/option.js";
import { IMPLIED_VOL_EXAMPLE_INPUT } from "../src/schemas/impliedVol.js";
import { VOL_SURFACE_EXAMPLE_INPUT } from "../src/schemas/volatility.js";
import {
  PORTFOLIO_GREEKS_EXAMPLE_INPUT,
  PORTFOLIO_SCENARIO_EXAMPLE_INPUT,
} from "../src/schemas/portfolio.js";
import {
  SURFACE_PRICE_EXAMPLE_INPUT,
  SURFACE_SCENARIO_EXAMPLE_INPUT,
} from "../src/schemas/surfacePricing.js";

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
    serviceVersion: "1.6.0",
    ...overrides,
  };
}

function registeredToolNames(server: McpServer): string[] {
  const tools = (
    server as unknown as { _registeredTools: Record<string, unknown> }
  )._registeredTools;
  return Object.keys(tools).sort();
}

describe("createDerivativesMcpServer (skipPayment)", () => {
  it("registers exactly the façade tool set", async () => {
    const server = await createDerivativesMcpServer(
      testConfig(),
      stubResourceServer,
    );
    expect(server).toBeInstanceOf(McpServer);
    expect(registeredToolNames(server)).toEqual(
      [...MCP_ALL_TOOL_NAMES].sort(),
    );
    expect(MCP_PAID_TOOL_NAMES).toHaveLength(7);
  });

  it("paid tools map to the same services as HTTP", () => {
    const opt = priceWithGreeks(OPTION_EXAMPLE_INPUT, "req-opt");
    expect(opt.price).toBeGreaterThan(0);
    expect(opt.greeks.delta).toBeDefined();

    const iv = solveImpliedVol(IMPLIED_VOL_EXAMPLE_INPUT, "req-iv");
    expect(iv.impliedVol).toBeCloseTo(0.2, 2);

    const surf = buildVolatilitySurface(
      {
        rate: VOL_SURFACE_EXAMPLE_INPUT.rate,
        dividendYield: VOL_SURFACE_EXAMPLE_INPUT.dividendYield,
      },
      VOL_SURFACE_EXAMPLE_INPUT.options,
      "req-surf",
    );
    expect(surf.points.length).toBe(VOL_SURFACE_EXAMPLE_INPUT.options.length);

    const greeks = aggregatePortfolio(
      PORTFOLIO_GREEKS_EXAMPLE_INPUT.rate,
      PORTFOLIO_GREEKS_EXAMPLE_INPUT.dividendYield,
      PORTFOLIO_GREEKS_EXAMPLE_INPUT.positions,
      true,
    );
    expect(greeks.mtm).toBeDefined();

    const scen = runPortfolioScenarios(
      PORTFOLIO_SCENARIO_EXAMPLE_INPUT.rate,
      PORTFOLIO_SCENARIO_EXAMPLE_INPUT.dividendYield,
      PORTFOLIO_SCENARIO_EXAMPLE_INPUT.positions,
      PORTFOLIO_SCENARIO_EXAMPLE_INPUT.scenarios,
    );
    expect(scen.scenarios.length).toBeGreaterThan(0);

    const pfs = priceFromSurface(SURFACE_PRICE_EXAMPLE_INPUT, "req-pfs");
    expect(pfs.results[0]!.impliedVol).toBeCloseTo(0.2, 3);

    const sfs = scenarioFromSurface(SURFACE_SCENARIO_EXAMPLE_INPUT, "req-sfs");
    expect(sfs.book.valueScenario).toBeGreaterThan(sfs.book.valueBase);
  });
});
