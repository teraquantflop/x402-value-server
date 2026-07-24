import { describe, expect, it } from "vitest";
import { config } from "../src/config.js";
import { buildWellKnownX402 } from "../src/discovery/catalog.js";

describe("buildWellKnownX402", () => {
  it("returns x402 protocol fields and paid resources", () => {
    const doc = buildWellKnownX402(config);
    expect(doc.x402Version).toBe(2);
    expect(doc.protocol).toBe("x402");
    expect(doc.name).toBeTruthy();
    expect(doc.url).toBe(config.publicBaseUrl.replace(/\/$/, ""));
    expect(doc.settlement.asset).toBe("USDC");
    expect(doc.settlement.facilitator).toBe(config.facilitatorUrl);
    expect(doc.settlement.payTo).toBe(config.payToAddress);
    expect(doc.resources.length).toBeGreaterThanOrEqual(2);

    const paths = doc.resources.map((r) => r.path);
    expect(paths).toContain("/v1/option/price");
    expect(paths).toContain("/v1/volatility/surface");

    for (const r of doc.resources) {
      expect(r.type).toBe("http");
      expect(r.method).toBe("POST");
      expect(r.url).toMatch(/^https?:\/\//);
      expect(r.price).toMatch(/^\$/);
      expect(r.asset).toBe("USDC");
      expect(r.scheme).toBe("exact");
    }

    expect(doc.links.wellKnown).toContain("/.well-known/x402.json");
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
