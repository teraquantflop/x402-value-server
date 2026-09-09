import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { config } from "../src/config.js";
import { buildLlmsTxt } from "../src/discovery/llmsTxt.js";
import { createApp } from "../src/app.js";
import { SERVICE_CATALOG } from "../src/discovery/catalog.js";

describe("buildLlmsTxt", () => {
  it("includes product name, endpoints, prices, and discovery links", () => {
    const text = buildLlmsTxt(config);
    expect(text.startsWith(`# ${SERVICE_CATALOG.productName}`)).toBe(true);
    expect(text).toContain(">");
    expect(text).toContain("/v1/option/price");
    expect(text).toContain("/v1/option/implied-vol");
    expect(text).toContain("/v1/volatility/surface");
    expect(text).toContain("/v1/portfolio/greeks");
    expect(text).toContain("/v1/portfolio/scenario");
    expect(text).toContain(config.priceDollarString);
    expect(text).toContain("openapi.json");
    expect(text).toContain("swagger.json");
    expect(text).toContain("/skill.md");
    expect(text).toMatch(/well-known\/x402/);
    expect(text).toMatch(/USDC|Solana|x402/i);
    expect(text).toContain("/llms.txt");
    expect(text).toMatch(/demo\/option-price|Price list/i);
    if (config.mcpEnabled) {
      expect(text).toMatch(/mcp|price_option/i);
    }
  });

  it("includes exact when to use / when not to use fence", () => {
    const text = buildLlmsTxt(config);
    expect(text).toContain("## When to use");
    expect(text).toContain("## When not to use");
    expect(text).toContain(SERVICE_CATALOG.whenToUse);
    expect(text).toContain(SERVICE_CATALOG.whenNotToUse);
    expect(text).not.toMatch(/nowcast|pjm/i);
  });

  it("documents MCP Accept header when MCP enabled", () => {
    if (!config.mcpEnabled) return;
    const text = buildLlmsTxt(config);
    expect(text).toMatch(/Accept:\s*`?application\/json,\s*text\/event-stream/);
    expect(text).toMatch(/MCP initialize curl/i);
  });
});

describe("GET /llms.txt HTTP", () => {
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

  it("returns 200 text/plain with key discovery terms", async () => {
    const res = await fetch(`${baseUrl}/llms.txt`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/plain/);
    const body = await res.text();
    expect(body).toContain("Derivatives");
    expect(body).toContain("/v1/option/price");
    expect(body).toContain("openapi.json");
    expect(body).toMatch(/x402|USDC/i);
    expect(body).toContain("When to use");
    expect(body).toContain("When not to use");
    expect(body).not.toMatch(/nowcast|pjm/i);
  });

  it("is listed on service card and well-known links", async () => {
    const [cardRes, wkRes] = await Promise.all([
      fetch(`${baseUrl}/`),
      fetch(`${baseUrl}/.well-known/x402.json`),
    ]);
    expect(cardRes.status).toBe(200);
    expect(wkRes.status).toBe(200);
    const card = (await cardRes.json()) as {
      whenToUse?: string;
      whenNotToUse?: string;
      endpoints: { free: { path: string }[] };
    };
    const wk = (await wkRes.json()) as { links?: { llmsTxt?: string } };
    expect(card.endpoints.free.some((e) => e.path === "/llms.txt")).toBe(true);
    expect(wk.links?.llmsTxt).toContain("/llms.txt");
    expect(card.whenToUse).toBe(SERVICE_CATALOG.whenToUse);
    expect(card.whenNotToUse).toBe(SERVICE_CATALOG.whenNotToUse);
    const cardText = JSON.stringify(card);
    expect(cardText).not.toMatch(/nowcast|pjm/i);
  });

  it("GET /robots.txt is 200 with User-agent allow-list", async () => {
    const res = await fetch(`${baseUrl}/robots.txt`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/plain/);
    expect(res.headers.get("cache-control")).toMatch(/max-age=3600/);
    const body = await res.text();
    expect(body).toContain("User-agent");
    expect(body).toContain("Allow: /");
    expect(body).toContain("/.well-known/");
    expect(body).toContain("/v1/demo/");
    expect(body).not.toMatch(/Disallow:\s*\/v1\//);
  });
});
