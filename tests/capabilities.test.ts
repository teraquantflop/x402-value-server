/**
 * Phase 3: GET /v1/capabilities matrix + job tags; no wallets / sibling product names.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { createApp } from "../src/app.js";
import { config } from "../src/config.js";
import { buildCapabilities } from "../src/discovery/capabilities.js";
import {
  optionPriceDiscovery,
  volatilitySurfaceDiscovery,
  portfolioGreeksDiscovery,
  portfolioScenarioDiscovery,
} from "../src/discovery/catalog.js";

describe("buildCapabilities", () => {
  it("exposes models, greek units, networks, prices, no wallets", () => {
    const cap = buildCapabilities(config);
    expect(cap.models.some((m) => m.id === "black-scholes-merton")).toBe(true);
    expect(cap.models.some((m) => m.id === "binomial-crr-american")).toBe(true);
    expect(cap.greeks.units.raw.vega).toMatch(/1\.0/);
    expect(cap.greeks.units.raw.theta).toMatch(/year/);
    expect(cap.greeks.units.raw.rho).toMatch(/1\.0/);
    expect(cap.greeks.conventions).toEqual(
      expect.arrayContaining(["raw", "trading"]),
    );
    expect(cap.models.some((m) => m.id === "black-76")).toBe(true);
    expect(cap.networks).toEqual(config.networks);
    expect(cap.networkIds).toEqual(config.networkIds);
    expect(cap.prices.optionPrice).toBe(config.priceDollarString);
    expect(cap.paidPaths).toContain("/v1/option/price");
    expect(cap.jobTags.mark.length).toBeGreaterThan(0);
    expect(cap.jobTags.iv_calib.length).toBeGreaterThan(0);
    const text = JSON.stringify(cap);
    expect(text).not.toMatch(/0x[a-fA-F0-9]{40}/);
    expect(text.toLowerCase()).not.toMatch(/"payto"/);
    expect(text).not.toMatch(/pjm|nowcast/i);
  });
});

describe("Bazaar discovery tags", () => {
  it("uses topical PayAI tags (options/black-scholes/greeks/surface/…)", () => {
    expect(optionPriceDiscovery(config).tags).toEqual(
      expect.arrayContaining(["options", "black-scholes", "greeks"]),
    );
    expect(volatilitySurfaceDiscovery(config).tags).toEqual(
      expect.arrayContaining(["volatility", "surface", "options"]),
    );
    expect(portfolioGreeksDiscovery(config).tags).toEqual(
      expect.arrayContaining(["portfolio", "greeks", "options"]),
    );
    expect(portfolioScenarioDiscovery(config).tags).toEqual(
      expect.arrayContaining(["portfolio", "scenario", "greeks"]),
    );
    expect(optionPriceDiscovery(config).iconUrl).toMatch(/\/favicon\.ico$/);
  });
});

describe("GET /v1/capabilities HTTP", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = createApp();
    await new Promise<void>((resolve) => {
      server = app.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no address");
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it("returns 200 JSON matrix", async () => {
    const res = await fetch(`${baseUrl}/v1/capabilities`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    const body = (await res.json()) as {
      models: { id: string }[];
      networks: string[];
      links?: { capabilities?: string };
    };
    expect(body.models.length).toBeGreaterThanOrEqual(2);
    expect(body.networks).toEqual(config.networks);
  });

  it("service card links to capabilities", async () => {
    const res = await fetch(`${baseUrl}/`);
    expect(res.status).toBe(200);
    const card = (await res.json()) as {
      links?: { capabilities?: string };
      endpoints?: { free: { path: string }[] };
    };
    expect(card.links?.capabilities).toContain("/v1/capabilities");
    expect(
      card.endpoints?.free.some((e) => e.path === "/v1/capabilities"),
    ).toBe(true);
  });
});
