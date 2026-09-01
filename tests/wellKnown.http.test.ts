import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { createApp } from "../src/app.js";

/**
 * HTTP smoke for well-known discovery (free, no payment).
 * Uses SKIP_PAYMENT only to avoid facilitator init noise; routes are free either way.
 */
describe("well-known x402 HTTP", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    process.env.SKIP_PAYMENT = "1";
    process.env.PAY_TO_ADDRESS =
      process.env.PAY_TO_ADDRESS ??
      "0x1111111111111111111111111111111111111111";
    process.env.NETWORKS = process.env.NETWORKS ?? "base-sepolia";

    // Re-import is heavy; createApp reads already-loaded config.
    // App still serves free routes without payment middleware when skip is set
    // at process start — for this test we only hit free paths.
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

  it("GET /.well-known/x402.json returns discovery JSON", async () => {
    const res = await fetch(`${baseUrl}/.well-known/x402.json`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    const body = (await res.json()) as {
      x402Version: number;
      resources: { path: string }[];
    };
    expect(body.x402Version).toBe(2);
    expect(body.resources.some((r) => r.path === "/v1/option/price")).toBe(
      true,
    );
    expect(
      body.resources.some((r) => r.path === "/v1/volatility/surface"),
    ).toBe(true);
    expect(
      body.resources.some((r) => r.path === "/v1/option/implied-vol"),
    ).toBe(true);
    expect(
      body.resources.some((r) => r.path === "/v1/portfolio/greeks"),
    ).toBe(true);
    expect(
      body.resources.some((r) => r.path === "/v1/portfolio/scenario"),
    ).toBe(true);
  });

  it("GET /.well-known/x402 matches .json alias", async () => {
    const [a, b] = await Promise.all([
      fetch(`${baseUrl}/.well-known/x402`),
      fetch(`${baseUrl}/.well-known/x402.json`),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    const ja = await a.json();
    const jb = await b.json();
    expect(ja).toEqual(jb);
  });

  it("well-known routes are registered at app root (not nested under a prefix)", async () => {
    // Negative: a nested prefix must not be required
    const nested = await fetch(`${baseUrl}/health/.well-known/x402.json`);
    expect(nested.status).toBe(404);

    const root = await fetch(`${baseUrl}/.well-known/x402.json`);
    expect(root.status).toBe(200);
  });

  it("GET / still returns service card with examples", async () => {
    const res = await fetch(`${baseUrl}/`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      examples?: unknown;
      endpoints?: unknown;
    };
    expect(body.examples).toBeDefined();
    expect(body.endpoints).toBeDefined();
  });

  it("GET /openapi.json returns OpenAPI JSON", async () => {
    const res = await fetch(`${baseUrl}/openapi.json`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    const body = (await res.json()) as {
      openapi?: string;
      paths?: Record<string, unknown>;
      info?: { title?: string };
    };
    expect(body.openapi).toMatch(/^3\./);
    expect(body.paths).toBeDefined();
    expect(body.paths?.["/v1/option/price"]).toBeDefined();
    expect(body.info?.title).toBeTruthy();
  });

  it("GET /.well-known/x402.json still works alongside openapi", async () => {
    const [wk, oa] = await Promise.all([
      fetch(`${baseUrl}/.well-known/x402.json`),
      fetch(`${baseUrl}/openapi.json`),
    ]);
    expect(wk.status).toBe(200);
    expect(oa.status).toBe(200);
    const wellKnown = (await wk.json()) as {
      x402Version: number;
      links?: { openapi?: string; agent?: string; x402Resources?: string };
    };
    expect(wellKnown.x402Version).toBe(2);
    expect(wellKnown.links?.openapi).toContain("/openapi.json");
    expect(wellKnown.links?.agent).toContain("/.well-known/agent.json");
    expect(wellKnown.links?.x402Resources).toContain(
      "/.well-known/x402-resources",
    );
  });

  it("GET /.well-known/agent.json returns free agent card", async () => {
    const res = await fetch(`${baseUrl}/.well-known/agent.json`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      name?: string;
      protocol?: string;
      networks?: unknown[];
      links?: { x402?: string; resources?: string; agentCard?: string };
    };
    expect(body.protocol).toBe("x402");
    expect(body.name).toBeTruthy();
    expect(Array.isArray(body.networks)).toBe(true);
    expect(body.links?.x402).toContain("/.well-known/x402.json");
    expect(body.links?.resources).toContain("/.well-known/x402-resources");
    expect(body.links?.agentCard).toContain("/.well-known/agent-card.json");
  });

  it("GET /.well-known/agent-card.json aliases agent.json (same JSON)", async () => {
    const [a, b] = await Promise.all([
      fetch(`${baseUrl}/.well-known/agent.json`),
      fetch(`${baseUrl}/.well-known/agent-card.json`),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(b.headers.get("content-type")).toMatch(/application\/json/);
    const ja = await a.json();
    const jb = await b.json();
    expect(jb).toEqual(ja);
    const text = JSON.stringify(jb);
    expect(text).not.toMatch(/0x[a-fA-F0-9]{40}/);
    expect(text.toLowerCase()).not.toMatch(/"payto"/);
  });

  it("POST /.well-known/agent-card.json returns 405 Allow GET", async () => {
    const res = await fetch(`${baseUrl}/.well-known/agent-card.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(405);
    expect((res.headers.get("allow") ?? "").toUpperCase()).toContain("GET");
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("method_not_allowed");
  });

  it("GET /.well-known/x402-resources returns paid resource index", async () => {
    const res = await fetch(`${baseUrl}/.well-known/x402-resources`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      protocol?: string;
      scheme?: string;
      resources?: { path: string; price: string }[];
    };
    expect(body.protocol).toBe("x402");
    expect(body.scheme).toBe("exact");
    expect(body.resources?.some((r) => r.path === "/v1/option/price")).toBe(
      true,
    );
    expect(
      body.resources?.some((r) => r.path === "/v1/volatility/surface"),
    ).toBe(true);
  });
});
