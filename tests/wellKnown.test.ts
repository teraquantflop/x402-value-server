import { describe, expect, it } from "vitest";
import { config } from "../src/config.js";
import {
  buildWellKnownAgent,
  buildWellKnownX402,
  buildWellKnownX402Resources,
} from "../src/discovery/catalog.js";

describe("buildWellKnownX402", () => {
  it("returns x402 protocol fields and paid resources", () => {
    const doc = buildWellKnownX402(config);
    expect(doc.x402Version).toBe(2);
    expect(doc.protocol).toBe("x402");
    expect(doc.name).toBeTruthy();
    expect(doc.url).toBe(config.publicBaseUrl.replace(/\/$/, ""));
    expect(doc.settlement.asset).toBe("USDC");
    expect(doc.settlement.facilitators).toBeDefined();
    expect(doc.settlement.facilitators.payai).toBe(true);
    // Wallets must not appear on free well-known settlement
    expect(
      (doc.settlement as { payTo?: string }).payTo,
    ).toBeUndefined();
    expect(doc.resources.length).toBeGreaterThanOrEqual(5);

    const paths = doc.resources.map((r) => r.path);
    expect(paths).toContain("/v1/option/price");
    expect(paths).toContain("/v1/option/implied-vol");
    expect(paths).toContain("/v1/volatility/surface");
    expect(paths).toContain("/v1/portfolio/greeks");
    expect(paths).toContain("/v1/portfolio/scenario");

    for (const r of doc.resources) {
      expect(r.type).toBe("http");
      expect(r.method).toBe("POST");
      expect(r.url).toMatch(/^https?:\/\//);
      expect(r.price).toMatch(/^\$/);
      expect(r.asset).toBe("USDC");
      expect(r.scheme).toBe("exact");
    }

    expect(doc.links.wellKnown).toContain("/.well-known/x402.json");
    expect(doc.links.openapi).toContain("/openapi.json");
    expect(doc.links.llmsTxt).toContain("/llms.txt");
    expect(doc.discovery.paymentHeader).toBe("PAYMENT-REQUIRED");
  });

  it("includes absolute resource URLs under publicBaseUrl", () => {
    const doc = buildWellKnownX402(config);
    const base = config.publicBaseUrl.replace(/\/$/, "");
    for (const r of doc.resources) {
      expect(r.url.startsWith(base)).toBe(true);
    }
  });
});

describe("buildWellKnownAgent / x402-resources", () => {
  it("agent card links to x402 and resources", () => {
    const agent = buildWellKnownAgent(config);
    expect(agent.protocol).toBe("x402");
    expect(agent.links.x402).toContain("/.well-known/x402.json");
    expect(agent.links.resources).toContain("/.well-known/x402-resources");
    expect(Array.isArray(agent.networks)).toBe(true);
  });

  it("resources index lists paid paths without payTo", () => {
    const doc = buildWellKnownX402Resources(config);
    expect(doc.protocol).toBe("x402");
    expect(doc.scheme).toBe("exact");
    expect(doc.resources.some((r) => r.path === "/v1/option/price")).toBe(true);
    expect(doc.note).toMatch(/POLY_PAY_TO/);
    for (const n of doc.networks) {
      expect((n as { payTo?: string }).payTo).toBeUndefined();
    }
  });
});
