import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Server } from "node:http";
import type { Express } from "express";
import { matchesOptionBookClient } from "../src/middleware/optionBookClient.js";

describe("matchesOptionBookClient", () => {
  it("returns false when expected is unset or empty", () => {
    expect(matchesOptionBookClient(undefined, "x")).toBe(false);
    expect(matchesOptionBookClient("", "x")).toBe(false);
  });

  it("returns false when header missing or wrong length", () => {
    expect(matchesOptionBookClient("abc", undefined)).toBe(false);
    expect(matchesOptionBookClient("abc", "")).toBe(false);
    expect(matchesOptionBookClient("abc", "ab")).toBe(false);
    expect(matchesOptionBookClient("abc", "abcd")).toBe(false);
  });

  it("returns true only on exact match (timingSafeEqual)", () => {
    expect(matchesOptionBookClient("secret-id", "secret-id")).toBe(true);
    expect(matchesOptionBookClient("secret-id", "secret-ix")).toBe(false);
  });
});

describe("OptionBookClient HTTP skip", () => {
  let server: Server;
  let baseUrl: string;
  const ID = "test-optionbook-id-32chars!!!!!!";

  async function listen(app: Express): Promise<{ server: Server; baseUrl: string }> {
    const s = await new Promise<Server>((resolve) => {
      const srv = app.listen(0, "127.0.0.1", () => resolve(srv));
    });
    const addr = s.address();
    if (!addr || typeof addr === "string") throw new Error("no address");
    return { server: s, baseUrl: `http://127.0.0.1:${addr.port}` };
  }

  beforeAll(async () => {
    vi.resetModules();
    delete process.env.SKIP_PAYMENT;
    process.env.NODE_ENV = "test";
    process.env.NETWORKS = "base-sepolia";
    process.env.PAY_TO_ADDRESS = "0x1111111111111111111111111111111111111111";
    process.env.FACILITATOR_URL = "https://x402.org/facilitator";
    process.env.OPTIONBOOK_ID = ID;
    process.env.FREE_TIER_N = "0";
    const { createApp } = await import("../src/app.js");
    ({ server, baseUrl } = await listen(createApp()));
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    delete process.env.OPTIONBOOK_ID;
  });

  const body = {
    spot: 100,
    strike: 100,
    timeToExpiry: 1,
    rate: 0.05,
    volatility: 0.2,
    optionType: "call",
  };

  it("matching OptionBookClient skips 402 and returns 200", async () => {
    const res = await fetch(`${baseUrl}/v1/option/price`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        OptionBookClient: ID,
      },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { price: number };
    expect(json.price).toBeGreaterThan(0);
  });

  it("wrong OptionBookClient falls through to 402", async () => {
    const res = await fetch(`${baseUrl}/v1/option/price`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        OptionBookClient: "wrong-optionbook-id-32chars!!!!",
      },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(402);
  });

  it("missing header falls through to 402", async () => {
    const res = await fetch(`${baseUrl}/v1/option/price`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(402);
  });
});
