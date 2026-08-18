import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const openapi = JSON.parse(
  readFileSync(join(process.cwd(), "openapi.json"), "utf8"),
) as {
  security?: unknown[];
  components?: { securitySchemes?: Record<string, unknown> };
  paths: Record<
    string,
    {
      get?: { security?: unknown[] };
      post?: { security?: unknown[] };
    }
  >;
};

const FREE_PATHS = [
  "/",
  "/health",
  "/openapi.json",
  "/llms.txt",
  "/v1/demo/option-price",
  "/mcp",
  "/.well-known/x402",
  "/.well-known/x402.json",
] as const;

const PAID_PATHS = [
  "/v1/option/price",
  "/v1/option/implied-vol",
  "/v1/volatility/surface",
  "/v1/option/price-from-surface",
  "/v1/option/scenario-from-surface",
  "/v1/portfolio/greeks",
  "/v1/portfolio/scenario",
] as const;

describe("openapi.json free vs paid security", () => {
  it("declares x402 security scheme and default paid security", () => {
    expect(openapi.components?.securitySchemes?.x402).toBeDefined();
    expect(openapi.security).toEqual([{ x402: [] }]);
  });

  it("marks free discovery operations with security: []", () => {
    for (const path of FREE_PATHS) {
      const op = openapi.paths[path]?.get ?? openapi.paths[path]?.post;
      expect(op, `missing operation on ${path}`).toBeDefined();
      // Empty array = no payment / no auth (OpenAPI standard override)
      expect(op!.security, `${path} must have security: []`).toEqual([]);
    }
  });

  it("marks paid /v1 operations with x402 security", () => {
    for (const path of PAID_PATHS) {
      const op = openapi.paths[path]?.post;
      expect(op, `missing POST ${path}`).toBeDefined();
      expect(op!.security, `${path} must require x402`).toEqual([{ x402: [] }]);
    }
  });
});
