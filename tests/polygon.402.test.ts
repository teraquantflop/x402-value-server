/**
 * HTTP: Polygon mainnet (eip155:137) in unpaid 402 accepts with POLY_PAY_TO.
 * Keeps Solana (+ optional Base) and free well-known discovery.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Server } from "node:http";
import type { Express } from "express";
import { getDefaultAsset } from "@x402/evm";

const SOLANA_PAYTO = "DCi9X5mmacNGLeJvCw9fdWgX3G8V4QquDn4EuXATkcYr";
const BASE_PAYTO = "0x34cfb8bdbf16e4484b7da0ed31deed5771b16c8f";
const POLY_PAYTO = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const SOLANA_CAIP2 = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
const BASE_CAIP2 = "eip155:8453";
const POLY_CAIP2 = "eip155:137";
const POLY_USDC = getDefaultAsset(POLY_CAIP2).address.toLowerCase();

interface AcceptRequirement {
  scheme?: string;
  network?: string;
  payTo?: string;
  asset?: string;
  extra?: { name?: string; version?: string };
}

function decodePaymentRequired(
  header: string | null,
): { accepts?: AcceptRequirement[] } | null {
  if (!header) return null;
  try {
    return JSON.parse(Buffer.from(header, "base64").toString("utf8")) as {
      accepts?: AcceptRequirement[];
    };
  } catch {
    try {
      return JSON.parse(header) as { accepts?: AcceptRequirement[] };
    } catch {
      return null;
    }
  }
}

function paymentRequiredHeader(res: Response): string | null {
  return (
    res.headers.get("PAYMENT-REQUIRED") ??
    res.headers.get("payment-required") ??
    res.headers.get("Payment-Required")
  );
}

function extractAccepts(payload: unknown): AcceptRequirement[] {
  if (!payload || typeof payload !== "object") return [];
  const obj = payload as Record<string, unknown>;
  if (Array.isArray(obj.accepts)) {
    return obj.accepts as AcceptRequirement[];
  }
  for (const key of ["paymentRequirements", "requirements", "accept"]) {
    const v = obj[key];
    if (Array.isArray(v)) return v as AcceptRequirement[];
  }
  if (typeof obj["PAYMENT-REQUIRED"] === "string") {
    const inner = decodePaymentRequired(obj["PAYMENT-REQUIRED"] as string);
    if (inner?.accepts) return inner.accepts;
  }
  return [];
}

async function collectAccepts(res: Response): Promise<AcceptRequirement[]> {
  const header = paymentRequiredHeader(res);
  let accepts = decodePaymentRequired(header)?.accepts ?? [];
  if (accepts.length === 0) {
    try {
      accepts = extractAccepts(await res.clone().json());
    } catch {
      // ignore
    }
  }
  if (accepts.length === 0 && header) {
    try {
      const raw = JSON.parse(
        Buffer.from(header, "base64").toString("utf8"),
      ) as Record<string, unknown>;
      accepts = extractAccepts(raw);
      if (accepts.length === 0 && raw.paymentRequired) {
        accepts = extractAccepts(raw.paymentRequired);
      }
    } catch {
      // ignore
    }
  }
  return accepts;
}

async function listen(app: Express): Promise<{ server: Server; baseUrl: string }> {
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no address");
  return { server, baseUrl: `http://127.0.0.1:${addr.port}` };
}

describe("Polygon mainnet 402 + discovery (PayAI)", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    vi.resetModules();
    delete process.env.SKIP_PAYMENT;
    process.env.NODE_ENV = "test";
    process.env.NETWORKS = "solana,base,polygon";
    process.env.PAY_TO_ADDRESS = SOLANA_PAYTO;
    process.env.PAY_TO_SVM_ADDRESS = SOLANA_PAYTO;
    process.env.PAY_TO_EVM_ADDRESS = BASE_PAYTO;
    process.env.POLY_PAY_TO = POLY_PAYTO;
    process.env.FACILITATOR_URL = "https://facilitator.payai.network";
    process.env.PUBLIC_BASE_URL = "http://localhost:4021";
    process.env.CDP_API_KEY_ID = "organizations/test/apiKeys/test";
    process.env.CDP_API_KEY_SECRET = Buffer.alloc(64, 7).toString("base64");

    const { createApp } = await import("../src/app.js");
    const app = createApp();
    ({ server, baseUrl } = await listen(app));
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it("GET /health lists polygon with facilitators.polygon=payai (no wallets)", async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      networks: string[];
      networkIds: string[];
      payToPolygon?: string;
      facilitators?: {
        payai?: boolean;
        polygon?: string;
        solana?: string;
        base?: string;
      };
    };
    expect(body.networks).toEqual(
      expect.arrayContaining(["solana", "base", "polygon"]),
    );
    expect(body.networkIds).toEqual(
      expect.arrayContaining([SOLANA_CAIP2, BASE_CAIP2, POLY_CAIP2]),
    );
    expect(body.payToPolygon).toBeUndefined();
    expect(body.facilitators?.payai).toBe(true);
    expect(body.facilitators?.polygon).toBe("payai");
    expect(body.facilitators?.solana).toBe("payai");
    expect(body.facilitators?.base).toBe("cdp");
  });

  it("GET /.well-known/agent.json and x402-resources return 200", async () => {
    const [agent, resources, x402] = await Promise.all([
      fetch(`${baseUrl}/.well-known/agent.json`),
      fetch(`${baseUrl}/.well-known/x402-resources`),
      fetch(`${baseUrl}/.well-known/x402`),
    ]);
    expect(agent.status).toBe(200);
    expect(resources.status).toBe(200);
    expect(x402.status).toBe(200);

    const agentBody = (await agent.json()) as {
      networks: { alias: string; caip2: string; payTo?: string }[];
      facilitators?: { polygon?: string };
    };
    expect(agentBody.networks.some((n) => n.caip2 === POLY_CAIP2)).toBe(true);
    for (const n of agentBody.networks) {
      expect(n.payTo).toBeUndefined();
    }
    expect(agentBody.facilitators?.polygon).toBe("payai");

    const resBody = (await resources.json()) as {
      networks: { caip2: string; payTo?: string }[];
      resources: { path: string }[];
      note?: string;
    };
    expect(resBody.networks.some((n) => n.caip2 === POLY_CAIP2)).toBe(true);
    expect(resBody.resources.some((r) => r.path === "/v1/option/price")).toBe(
      true,
    );
    expect(
      resBody.resources.some((r) => r.path === "/v1/volatility/surface"),
    ).toBe(true);
    expect(resBody.note).toMatch(/POLY_PAY_TO/);
  });

  it("unpaid POST /v1/option/price 402 lists Polygon with POLY_PAY_TO", async () => {
    const res = await fetch(`${baseUrl}/v1/option/price`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        spot: 100,
        strike: 100,
        timeToExpiry: 1,
        rate: 0.05,
        volatility: 0.2,
        optionType: "call",
      }),
    });
    expect(res.status).toBe(402);

    const accepts = await collectAccepts(res);
    expect(accepts.length).toBeGreaterThanOrEqual(3);

    const networks = accepts.map((a) => a.network);
    expect(networks).toEqual(
      expect.arrayContaining([SOLANA_CAIP2, BASE_CAIP2, POLY_CAIP2]),
    );

    const sol = accepts.find((a) => a.network === SOLANA_CAIP2);
    const base = accepts.find((a) => a.network === BASE_CAIP2);
    const poly = accepts.find((a) => a.network === POLY_CAIP2);

    expect(sol?.scheme).toBe("exact");
    expect(sol?.payTo).toBe(SOLANA_PAYTO);

    expect(base?.scheme).toBe("exact");
    expect(String(base?.payTo).toLowerCase()).toBe(BASE_PAYTO.toLowerCase());

    expect(poly?.scheme).toBe("exact");
    expect(String(poly?.payTo).toLowerCase()).toBe(POLY_PAYTO.toLowerCase());
    expect(String(poly?.payTo).toLowerCase()).not.toBe(BASE_PAYTO.toLowerCase());
    expect(poly?.asset?.toLowerCase()).toBe(POLY_USDC);
    expect(POLY_USDC).toBe("0x3c499c542cef5e3811e1192ce70d8cc03d5c3359");
    expect(poly?.extra?.name).toBe("USD Coin");
    expect(poly?.extra?.version).toBe("2");
  });

  it("unpaid POST /v1/volatility/surface 402 lists Polygon with POLY_PAY_TO", async () => {
    const res = await fetch(`${baseUrl}/v1/volatility/surface`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rate: 0.05, options: [] }),
    });
    expect(res.status).toBe(402);

    const accepts = await collectAccepts(res);
    expect(accepts.length).toBeGreaterThanOrEqual(3);

    const poly = accepts.find((a) => a.network === POLY_CAIP2);
    const sol = accepts.find((a) => a.network === SOLANA_CAIP2);
    expect(poly?.scheme).toBe("exact");
    expect(String(poly?.payTo).toLowerCase()).toBe(POLY_PAYTO.toLowerCase());
    expect(sol?.payTo).toBe(SOLANA_PAYTO);
  });
});
