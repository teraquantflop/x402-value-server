/**
 * Phase 1: structured access log + requestId join to Railway Network Flow.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Server } from "node:http";
import type { Express } from "express";
import {
  accessLogLooksSafe,
  buildAccessLogLine,
  classifyPayment,
  isPaidHttpPath,
} from "../src/middleware/accessLog.js";

const SOLANA_PAYTO = "DCi9X5mmacNGLeJvCw9fdWgX3G8V4QquDn4EuXATkcYr";

describe("accessLog helpers", () => {
  it("classifies 402 as challenge", () => {
    expect(
      classifyPayment({
        status: 402,
        path: "/v1/option/price",
        method: "POST",
        hasPaymentResponse: false,
      }),
    ).toBe("challenge");
  });

  it("classifies discovery 200 as free", () => {
    expect(
      classifyPayment({
        status: 200,
        path: "/",
        method: "GET",
        hasPaymentResponse: false,
      }),
    ).toBe("free");
  });

  it("classifies paid 2xx with payment-response as settled", () => {
    expect(
      classifyPayment({
        status: 200,
        path: "/v1/option/price",
        method: "POST",
        hasPaymentResponse: true,
      }),
    ).toBe("settled");
  });

  it("classifies MCP 406 as other", () => {
    expect(
      classifyPayment({
        status: 406,
        path: "/mcp",
        method: "POST",
        hasPaymentResponse: false,
      }),
    ).toBe("other");
  });

  it("isPaidHttpPath excludes demo", () => {
    expect(isPaidHttpPath("/v1/option/price")).toBe(true);
    expect(isPaidHttpPath("/v1/demo/option-price")).toBe(false);
    expect(isPaidHttpPath("/health")).toBe(false);
  });

  it("buildAccessLogLine has required keys and looks safe", () => {
    const line = buildAccessLogLine({
      requestId: "gX3fuhG_S0Ow-jJUn6XIxQ",
      method: "GET",
      path: "/",
      status: 200,
      ms: 7,
      payment: "free",
      network: null,
      uaApp: "x402-observer/1.0 (uptime+trust monitor)",
      now: new Date("2026-09-08T04:09:30.512Z"),
    });
    expect(line.ts).toBe("2026-09-08T04:09:30.512Z");
    expect(line.requestId).toBe("gX3fuhG_S0Ow-jJUn6XIxQ");
    expect(line.payment).toBe("free");
    expect(line.network).toBeNull();
    expect(accessLogLooksSafe(line)).toBe(true);
    expect(JSON.stringify(line)).not.toMatch(/0x[a-fA-F0-9]{40}/);
    expect(JSON.stringify(line).toLowerCase()).not.toMatch(/"payto"/);
  });
});

async function listen(app: Express): Promise<{ server: Server; baseUrl: string }> {
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no address");
  return { server, baseUrl: `http://127.0.0.1:${addr.port}` };
}

describe("HTTP access log + X-Request-Id join", () => {
  let server: Server;
  let baseUrl: string;
  const lines: string[] = [];
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    vi.resetModules();
    delete process.env.SKIP_PAYMENT;
    process.env.NODE_ENV = "test";
    process.env.NETWORKS = "solana";
    process.env.PAY_TO_ADDRESS = SOLANA_PAYTO;
    process.env.PAY_TO_SVM_ADDRESS = SOLANA_PAYTO;
    process.env.FACILITATOR_URL = "https://facilitator.payai.network";
    process.env.PUBLIC_BASE_URL = "http://localhost:4021";
    process.env.FREE_TIER_N = "0";
    delete process.env.CDP_API_KEY_ID;
    delete process.env.CDP_API_KEY_SECRET;

    logSpy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      const s = args.map(String).join(" ");
      if (s.startsWith("{") && s.includes('"requestId"')) lines.push(s);
    });
    warnSpy = vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
      const s = args.map(String).join(" ");
      if (s.startsWith("{") && s.includes('"requestId"')) lines.push(s);
    });

    const { createApp } = await import("../src/app.js");
    ({ server, baseUrl } = await listen(createApp()));
  });

  afterAll(async () => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it("echoes x-railway-request-id as X-Request-Id and logs matching requestId", async () => {
    lines.length = 0;
    const rid = "gX3fuhG_S0Ow-jJUn6XIxQ";
    const res = await fetch(`${baseUrl}/health`, {
      headers: { "x-railway-request-id": rid },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-request-id")).toBe(rid);

    // wait for finish hook
    await new Promise((r) => setTimeout(r, 30));
    const hit = lines.map((l) => JSON.parse(l) as { requestId: string; path: string; payment: string }).find(
      (l) => l.path === "/health" && l.requestId === rid,
    );
    expect(hit).toBeTruthy();
    expect(hit!.payment).toBe("free");
    expect(JSON.stringify(hit)).not.toMatch(/0x[a-fA-F0-9]{40}/);
  });

  it("unpaid POST /v1/option/price still 402 and logs payment=challenge", async () => {
    lines.length = 0;
    const res = await fetch(`${baseUrl}/v1/option/price`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-railway-request-id": "test-challenge-rid-001",
      },
      body: "{}",
    });
    expect(res.status).toBe(402);
    expect(res.headers.get("x-request-id")).toBe("test-challenge-rid-001");
    const pr =
      res.headers.get("PAYMENT-REQUIRED") ?? res.headers.get("payment-required");
    expect(pr).toBeTruthy();

    await new Promise((r) => setTimeout(r, 30));
    const hit = lines
      .map((l) => JSON.parse(l) as { requestId: string; path: string; payment: string; status: number })
      .find((l) => l.path === "/v1/option/price" && l.status === 402);
    expect(hit).toBeTruthy();
    expect(hit!.payment).toBe("challenge");
    expect(hit!.requestId).toBe("test-challenge-rid-001");
    expect(JSON.stringify(hit).toLowerCase()).not.toMatch(/"payto"/);
  });
});
