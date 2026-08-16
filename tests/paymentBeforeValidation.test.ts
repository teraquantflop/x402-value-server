/**
 * Paid routes: x402 payment gate must run before body/schema validation.
 * Unpaid empty / partial / malformed JSON → 402 (not 400).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Server } from "node:http";
import type { Express } from "express";

const PAY_TO = "0x1111111111111111111111111111111111111111";

function hasPaymentRequiredHeader(res: Response): boolean {
  const keys = [...res.headers.keys()].map((k) => k.toLowerCase());
  return keys.some(
    (k) => k.includes("payment-required") || k.includes("x-payment"),
  );
}

async function listen(app: Express): Promise<{ server: Server; baseUrl: string }> {
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no address");
  return { server, baseUrl: `http://127.0.0.1:${addr.port}` };
}

describe("payment before validation (unpaid → 402)", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    vi.resetModules();
    delete process.env.SKIP_PAYMENT;
    process.env.NODE_ENV = "test";
    process.env.PAY_TO_ADDRESS = PAY_TO;
    process.env.NETWORKS = "base-sepolia";
    process.env.FACILITATOR_URL =
      process.env.FACILITATOR_URL ?? "https://x402.org/facilitator";
    process.env.FREE_TIER_N = "0";

    const { createApp } = await import("../src/app.js");
    ({ server, baseUrl } = await listen(createApp()));
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it("POST /v1/option/price with empty object unpaid returns 402 not 400", async () => {
    const res = await fetch(`${baseUrl}/v1/option/price`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(402);
    expect(hasPaymentRequiredHeader(res)).toBe(true);
  });

  it("POST /v1/option/price with no body unpaid returns 402 not 400", async () => {
    const res = await fetch(`${baseUrl}/v1/option/price`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(402);
    expect(hasPaymentRequiredHeader(res)).toBe(true);
  });

  it("POST /v1/option/price with partial body unpaid returns 402 not 400", async () => {
    const res = await fetch(`${baseUrl}/v1/option/price`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ spot: 100 }),
    });
    expect(res.status).toBe(402);
    expect(hasPaymentRequiredHeader(res)).toBe(true);
  });

  it("POST /v1/option/price with malformed JSON unpaid returns 402 not 400", async () => {
    const res = await fetch(`${baseUrl}/v1/option/price`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not-valid-json",
    });
    expect(res.status).toBe(402);
    expect(hasPaymentRequiredHeader(res)).toBe(true);
  });

  it("POST /v1/volatility/surface with empty body unpaid returns 402", async () => {
    const res = await fetch(`${baseUrl}/v1/volatility/surface`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(402);
    expect(hasPaymentRequiredHeader(res)).toBe(true);
  });

  it("POST /v1/option/implied-vol with malformed JSON unpaid returns 402", async () => {
    const res = await fetch(`${baseUrl}/v1/option/implied-vol`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{broken",
    });
    expect(res.status).toBe(402);
    expect(hasPaymentRequiredHeader(res)).toBe(true);
  });
});

describe("validation after payment skip (SKIP_PAYMENT → 400)", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    vi.resetModules();
    process.env.SKIP_PAYMENT = "1";
    process.env.NODE_ENV = "test";
    process.env.PAY_TO_ADDRESS = PAY_TO;
    process.env.NETWORKS = "base-sepolia";
    process.env.FREE_TIER_N = "0";

    const { createApp } = await import("../src/app.js");
    ({ server, baseUrl } = await listen(createApp()));
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    delete process.env.SKIP_PAYMENT;
  });

  it("invalid body after skip payment returns 400 validation_error", async () => {
    const res = await fetch(`${baseUrl}/v1/option/price`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("validation_error");
  });

  it("malformed JSON after skip payment returns 400 invalid_json", async () => {
    const res = await fetch(`${baseUrl}/v1/option/price`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not-json",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("invalid_json");
  });
});
