/**
 * Free/catalog routes must never echo receiving wallets.
 * 402 PAYMENT-REQUIRED still includes payTo (protocol only).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Server } from "node:http";
import type { Express } from "express";

const EVM = "0x34cfb8bdbf16e4484b7da0ed31deed5771b16c8f";
const SVM = "DCi9X5mmacNGLeJvCw9fdWgX3G8V4QquDn4EuXATkcYr";

function assertNoWallets(text: string): void {
  const lower = text.toLowerCase();
  expect(lower).not.toContain(EVM.toLowerCase());
  expect(text).not.toContain(SVM);
  // field names that would leak receive addresses
  expect(lower).not.toMatch(/"payto"/);
  expect(lower).not.toMatch(/"paytoevm"/);
  expect(lower).not.toMatch(/"paytosvm"/);
}

async function listen(app: Express): Promise<{ server: Server; baseUrl: string }> {
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no address");
  return { server, baseUrl: `http://127.0.0.1:${addr.port}` };
}

describe("wallet hygiene on free routes", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    vi.resetModules();
    delete process.env.SKIP_PAYMENT;
    process.env.NODE_ENV = "test";
    process.env.NETWORKS = "solana,base";
    process.env.PAY_TO_ADDRESS = SVM;
    process.env.PAY_TO_SVM_ADDRESS = SVM;
    process.env.PAY_TO_EVM_ADDRESS = EVM;
    process.env.FACILITATOR_URL = "https://facilitator.payai.network";
    process.env.FREE_TIER_N = "0";

    const { createApp } = await import("../src/app.js");
    ({ server, baseUrl } = await listen(createApp()));
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it.each([
    "/health",
    "/",
    "/openapi.json",
    "/llms.txt",
    "/.well-known/x402.json",
    "/v1/demo/option-price",
  ])("%s does not expose wallets", async (path) => {
    const res = await fetch(`${baseUrl}${path}`);
    expect(res.status).toBe(200);
    assertNoWallets(await res.text());
  });

  it("health reports facilitator labels without payTo", async () => {
    const res = await fetch(`${baseUrl}/health`);
    const body = (await res.json()) as {
      facilitators?: { payai?: boolean; cdp?: boolean; base?: string };
      payTo?: string;
    };
    expect(body.payTo).toBeUndefined();
    expect(body.facilitators?.payai).toBe(true);
    expect(body.facilitators?.base === "payai" || body.facilitators?.base === "cdp").toBe(
      true,
    );
  });

  it("unpaid 402 still includes payTo in PAYMENT-REQUIRED", async () => {
    const res = await fetch(`${baseUrl}/v1/option/price`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(402);
    const header =
      res.headers.get("PAYMENT-REQUIRED") ??
      res.headers.get("payment-required");
    expect(header).toBeTruthy();
    const decoded = JSON.parse(
      Buffer.from(header!, "base64").toString("utf8"),
    ) as { accepts?: { payTo?: string; network?: string }[] };
    const paytos = (decoded.accepts ?? []).map((a) => a.payTo);
    expect(paytos.some((p) => p === SVM || p?.toLowerCase() === EVM.toLowerCase())).toBe(
      true,
    );
  });
});
