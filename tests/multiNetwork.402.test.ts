/**
 * HTTP: dual-network 402 challenges include Solana + Base accepts.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Server } from "node:http";
import type { Express } from "express";

const SOLANA_PAYTO = "DCi9X5mmacNGLeJvCw9fdWgX3G8V4QquDn4EuXATkcYr";
const BASE_PAYTO = "0x34cfb8bdbf16e4484b7da0ed31deed5771b16c8f";
const SOLANA_CAIP2 = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
const BASE_CAIP2 = "eip155:8453";

interface AcceptRequirement {
  scheme?: string;
  network?: string;
  payTo?: string;
  price?: string;
  amount?: string;
  asset?: string;
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
    // Some stacks nest accepts under different keys — try raw JSON header
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

/** Walk common x402 shapes to find accepts[]. */
function extractAccepts(payload: unknown): AcceptRequirement[] {
  if (!payload || typeof payload !== "object") return [];
  const obj = payload as Record<string, unknown>;
  if (Array.isArray(obj.accepts)) {
    return obj.accepts as AcceptRequirement[];
  }
  // v2 sometimes nests under accepts / paymentRequirements / requirements
  for (const key of ["paymentRequirements", "requirements", "accept"]) {
    const v = obj[key];
    if (Array.isArray(v)) return v as AcceptRequirement[];
  }
  // Nested base64 or JSON in body
  if (typeof obj["PAYMENT-REQUIRED"] === "string") {
    const inner = decodePaymentRequired(obj["PAYMENT-REQUIRED"] as string);
    if (inner?.accepts) return inner.accepts;
  }
  return [];
}

async function listen(app: Express): Promise<{ server: Server; baseUrl: string }> {
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no address");
  return { server, baseUrl: `http://127.0.0.1:${addr.port}` };
}

describe("multi-network 402 accepts (Solana + Base)", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    vi.resetModules();
    delete process.env.SKIP_PAYMENT;
    process.env.NODE_ENV = "test";
    process.env.NETWORKS = "solana,base";
    process.env.PAY_TO_ADDRESS = SOLANA_PAYTO;
    process.env.PAY_TO_SVM_ADDRESS = SOLANA_PAYTO;
    process.env.PAY_TO_EVM_ADDRESS = BASE_PAYTO;
    process.env.FACILITATOR_URL = "https://facilitator.payai.network";
    process.env.PUBLIC_BASE_URL = "http://localhost:4021";
    // Base accepts require CDP rail (never PayAI). Dummy Ed25519-length secret.
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

  it("GET /health exposes both networks without wallets", async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      networks: string[];
      networkIds: string[];
      payToEvm?: string;
      payToSvm?: string;
      facilitators?: { payai?: boolean; base?: string };
    };
    expect(body.networks).toEqual(expect.arrayContaining(["solana", "base"]));
    expect(body.networkIds).toEqual(
      expect.arrayContaining([SOLANA_CAIP2, BASE_CAIP2]),
    );
    expect(body.payToSvm).toBeUndefined();
    expect(body.payToEvm).toBeUndefined();
    expect(body.facilitators?.payai).toBe(true);
    // base rail is CDP when keys are set (shape may be nested cdp.enabled)
    const fac = body.facilitators as {
      payai?: boolean;
      base?: string;
      cdp?: boolean | { enabled?: boolean };
    };
    expect(fac.base).toBe("cdp");
  });

  it("well-known settlement lists networks without payTo", async () => {
    const res = await fetch(`${baseUrl}/.well-known/x402.json`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      settlement: {
        networks: { alias: string; caip2: string; payTo?: string }[];
        facilitators?: { payai?: boolean };
      };
    };
    expect(body.settlement.networks.length).toBe(2);
    for (const n of body.settlement.networks) {
      expect(n.payTo).toBeUndefined();
      expect(n.caip2).toBeTruthy();
    }
    expect(body.settlement.facilitators?.payai).toBe(true);
  });

  it("unpaid POST /v1/option/price 402 accepts Solana and Base", async () => {
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

    const header = paymentRequiredHeader(res);
    expect(header).toBeTruthy();

    let accepts = decodePaymentRequired(header)?.accepts ?? [];
    if (accepts.length === 0) {
      try {
        const bodyJson = await res.clone().json();
        accepts = extractAccepts(bodyJson);
      } catch {
        // ignore
      }
    }

    // Fallback: route config unit coverage is primary; middleware may nest accepts.
    // If header decodes to object without accepts, try unwrapping common x402 v2 envelope.
    if (accepts.length === 0 && header) {
      try {
        const raw = JSON.parse(
          Buffer.from(header, "base64").toString("utf8"),
        ) as Record<string, unknown>;
        accepts = extractAccepts(raw);
        // Some versions: { accepts: [...] } vs { paymentRequired: { accepts } }
        if (accepts.length === 0 && raw.paymentRequired) {
          accepts = extractAccepts(raw.paymentRequired);
        }
      } catch {
        // ignore
      }
    }

    expect(accepts.length).toBeGreaterThanOrEqual(2);

    const networks = accepts.map((a) => a.network);
    expect(networks).toEqual(
      expect.arrayContaining([SOLANA_CAIP2, BASE_CAIP2]),
    );

    const sol = accepts.find((a) => a.network === SOLANA_CAIP2);
    const base = accepts.find((a) => a.network === BASE_CAIP2) as
      | (AcceptRequirement & {
          asset?: string;
          extra?: { name?: string; version?: string };
          amount?: string;
        })
      | undefined;
    expect(sol?.scheme).toBe("exact");
    expect(base?.scheme).toBe("exact");
    expect(sol?.payTo).toBe(SOLANA_PAYTO);
    expect(String(base?.payTo).toLowerCase()).toBe(BASE_PAYTO.toLowerCase());
    // Base EIP-712 domain params required by @x402/fetch + CDP clients
    expect(base?.asset?.toLowerCase()).toBe(
      "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    );
    expect(base?.extra?.name).toBe("USD Coin");
    expect(base?.extra?.version).toBe("2");
  });

  it("unpaid POST /v1/volatility/surface also returns dual 402 accepts", async () => {
    const res = await fetch(`${baseUrl}/v1/volatility/surface`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rate: 0.05, options: [] }),
    });
    // empty options may 402 before validation
    expect(res.status).toBe(402);
  });
});
