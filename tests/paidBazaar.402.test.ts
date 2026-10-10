/**
 * Every paid x402 route must declare stock extensions.bazaar HTTP envelope:
 * info.input.type === "http", bodyType === "json", body = request example;
 * schema.properties.input.properties.body = request-body JSON Schema.
 * Paid set is discovered via unpaid POST → 402 + PAYMENT-REQUIRED.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Server } from "node:http";
import type { Express } from "express";
import {
  buildPaidRoutes,
  paidPostPaths,
} from "../src/x402/routeConfig.js";

const SOLANA_PAYTO = "DCi9X5mmacNGLeJvCw9fdWgX3G8V4QquDn4EuXATkcYr";

function paymentRequiredHeader(res: Response): string | null {
  return (
    res.headers.get("PAYMENT-REQUIRED") ??
    res.headers.get("payment-required") ??
    res.headers.get("Payment-Required")
  );
}

function decodePaymentRequired(header: string): Record<string, unknown> | null {
  try {
    return JSON.parse(Buffer.from(header, "base64").toString("utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    try {
      return JSON.parse(header) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

function extractBazaar(
  payload: Record<string, unknown> | null,
): {
  info?: {
    input?: {
      type?: string;
      method?: string;
      bodyType?: string;
      body?: Record<string, unknown>;
    };
    output?: { type?: string; example?: unknown };
  };
  schema?: {
    type?: string;
    required?: string[];
    properties?: {
      input?: {
        required?: string[];
        properties?: {
          type?: unknown;
          method?: unknown;
          bodyType?: unknown;
          body?: { properties?: Record<string, unknown> };
        };
      };
    };
  };
} | null {
  if (!payload) return null;
  const extensions = payload.extensions as
    | Record<string, unknown>
    | undefined;
  if (extensions?.bazaar && typeof extensions.bazaar === "object") {
    return extensions.bazaar as NonNullable<ReturnType<typeof extractBazaar>>;
  }
  const accepts = payload.accepts;
  if (Array.isArray(accepts)) {
    for (const a of accepts) {
      if (!a || typeof a !== "object") continue;
      const ext = (a as { extensions?: { bazaar?: unknown } }).extensions
        ?.bazaar;
      if (ext && typeof ext === "object") {
        return ext as NonNullable<ReturnType<typeof extractBazaar>>;
      }
    }
  }
  return null;
}

async function listen(app: Express): Promise<{ server: Server; baseUrl: string }> {
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no address");
  return { server, baseUrl: `http://127.0.0.1:${addr.port}` };
}

describe("paid routes: 402 extensions.bazaar HTTP envelope", () => {
  let server: Server;
  let baseUrl: string;
  /** Paths confirmed paid by unpaid POST → 402 + PAYMENT-REQUIRED. */
  let paidPaths: string[] = [];

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
    process.env.MCP_ENABLED = "0";
    delete process.env.CONTACT_EMAIL;

    const { createApp } = await import("../src/app.js");
    const { config } = await import("../src/config.js");
    const candidates = paidPostPaths(
      buildPaidRoutes(config, { cdpEnabled: false }),
    );
    const app = createApp();
    ({ server, baseUrl } = await listen(app));

    const confirmed: string[] = [];
    for (const path of candidates) {
      const res = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      const hdr = paymentRequiredHeader(res);
      if (res.status === 402 && hdr) {
        confirmed.push(path);
      }
    }
    paidPaths = confirmed.sort();
    expect(paidPaths.length).toBeGreaterThan(0);
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it("discovers the known paid POSTs via unpaid 402", () => {
    const expected = [
      "/v1/option/implied-vol",
      "/v1/option/price",
      "/v1/option/price-from-surface",
      "/v1/option/scenario-from-surface",
      "/v1/portfolio/greeks",
      "/v1/portfolio/scenario",
      "/v1/volatility/surface",
    ];
    expect(paidPaths).toEqual(expected);
  });

  it("every paid path returns stock bazaar HTTP envelope with body schema", async () => {
    for (const path of paidPaths) {
      const res = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      expect(res.status, path).toBe(402);
      const hdr = paymentRequiredHeader(res);
      expect(hdr, `${path} PAYMENT-REQUIRED`).toBeTruthy();
      const decoded = decodePaymentRequired(hdr!);
      const bazaar = extractBazaar(decoded);
      expect(bazaar, `${path} extensions.bazaar`).toBeTruthy();

      const input = bazaar!.info?.input;
      expect(input?.type, `${path} info.input.type`).toBe("http");
      expect(input?.bodyType, `${path} info.input.bodyType`).toBe("json");
      expect(input?.method, `${path} info.input.method`).toBe("POST");
      expect(
        input?.body && typeof input.body === "object",
        `${path} info.input.body`,
      ).toBe(true);

      const output = bazaar!.info?.output;
      expect(output?.type, `${path} info.output.type`).toBe("json");
      expect(output?.example, `${path} info.output.example`).toBeTruthy();

      const schema = bazaar!.schema;
      expect(schema?.type, `${path} schema.type`).toBe("object");
      expect(schema?.required, `${path} schema.required`).toContain("input");
      const inputReq = schema?.properties?.input?.required ?? [];
      for (const key of ["type", "method", "bodyType", "body"] as const) {
        expect(inputReq, `${path} properties.input.required`).toContain(key);
      }
      const bodyProps =
        schema?.properties?.input?.properties?.body?.properties;
      expect(
        bodyProps && Object.keys(bodyProps).length > 0,
        `${path} schema.properties.input.properties.body.properties`,
      ).toBe(true);
    }
  });
});
