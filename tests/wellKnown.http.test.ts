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
});
