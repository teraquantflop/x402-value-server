/**
 * /openapi.json: every paid path has inline requestBody schema (no $ref)
 * and x-payment-info. Paid set discovered via unpaid POST → 402.
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

function schemaHasRef(node: unknown): boolean {
  if (Array.isArray(node)) return node.some(schemaHasRef);
  if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k === "$ref") return true;
      if (schemaHasRef(v)) return true;
    }
  }
  return false;
}

async function listen(app: Express): Promise<{ server: Server; baseUrl: string }> {
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no address");
  return { server, baseUrl: `http://127.0.0.1:${addr.port}` };
}

describe("GET /openapi.json paid operations", () => {
  let server: Server;
  let baseUrl: string;
  let paidPaths: string[] = [];
  let openapi: {
    info?: { contact?: { email?: string } };
    paths: Record<
      string,
      {
        post?: {
          requestBody?: {
            content?: {
              "application/json"?: { schema?: unknown };
            };
          };
          responses?: Record<string, unknown>;
          "x-payment-info"?: {
            protocols?: string[];
            pricingMode?: string;
            price?: string;
            currency?: string;
          };
        };
      }
    >;
  };

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
    process.env.CONTACT_EMAIL = "desk-test@example.com";

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
      if (res.status === 402 && paymentRequiredHeader(res)) {
        confirmed.push(path);
      }
    }
    paidPaths = confirmed.sort();
    expect(paidPaths.length).toBeGreaterThan(0);

    const oaRes = await fetch(`${baseUrl}/openapi.json`);
    expect(oaRes.status).toBe(200);
    openapi = (await oaRes.json()) as typeof openapi;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it("sets info.contact.email from CONTACT_EMAIL", () => {
    expect(openapi.info?.contact?.email).toBe("desk-test@example.com");
  });

  it("every paid path has inline requestBody schema (no $ref) and x-payment-info", () => {
    for (const path of paidPaths) {
      const post = openapi.paths[path]?.post;
      expect(post, `POST ${path}`).toBeDefined();
      const schema = post!.requestBody?.content?.["application/json"]?.schema;
      expect(schema, `${path} requestBody schema`).toBeDefined();
      expect(
        schemaHasRef(schema),
        `${path} requestBody schema must not use $ref`,
      ).toBe(false);
      const props = (schema as { properties?: Record<string, unknown> })
        .properties;
      expect(
        props && Object.keys(props).length > 0,
        `${path} inline schema.properties`,
      ).toBe(true);
      expect(post!.responses?.["402"], `${path} responses.402`).toBeDefined();

      const pay = post!["x-payment-info"];
      expect(pay, `${path} x-payment-info`).toBeDefined();
      expect(pay!.protocols).toEqual(["x402"]);
      expect(pay!.pricingMode).toBe("fixed");
      expect(pay!.currency).toBe("USDC");
      expect(typeof pay!.price).toBe("string");
      expect(pay!.price!.startsWith("$")).toBe(true);
    }
  });

  it("GET /swagger.json matches /openapi.json", async () => {
    const [a, b] = await Promise.all([
      fetch(`${baseUrl}/openapi.json`).then((r) => r.json()),
      fetch(`${baseUrl}/swagger.json`).then((r) => r.json()),
    ]);
    expect(a).toEqual(b);
  });
});
