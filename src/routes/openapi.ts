import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Router, type Request, type Response } from "express";
import { config } from "../config.js";
import { enrichOpenApiDocument } from "./openapiEnrich.js";

/**
 * Load openapi.json once at process start.
 * Production (Docker/Railway): file is copied next to package root (cwd = /app).
 * Dev: same path relative to project root.
 */
function loadOpenApiDocument(): unknown {
  const candidates = [
    join(process.cwd(), "openapi.json"),
    // When started from dist/ via some hosts
    join(process.cwd(), "dist", "openapi.json"),
  ];

  let lastErr: unknown;
  for (const path of candidates) {
    try {
      const raw = readFileSync(path, "utf8");
      return JSON.parse(raw) as unknown;
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(
    `openapi.json not found (tried: ${candidates.join(", ")}). ` +
      `Ensure the file is present in the deploy image. Last error: ${
        lastErr instanceof Error ? lastErr.message : String(lastErr)
      }`,
  );
}

const openApiDocumentRaw = loadOpenApiDocument();

/** Enriched OpenAPI (inline paid requestBody schemas + x-payment-info). */
export function getOpenApiDocument(): unknown {
  return enrichOpenApiDocument(openApiDocumentRaw, config, {
    cdpEnabled: config.cdpConfigured,
  });
}

/** Snapshot used by unit tests; same enrichment as GET /openapi.json. */
export const openApiDocument = getOpenApiDocument();

export const openapiRouter = Router();

function sendOpenApi(_req: Request, res: Response): void {
  res
    .status(200)
    .type("application/json")
    .setHeader("Cache-Control", "public, max-age=300")
    .json(getOpenApiDocument());
}

openapiRouter.get("/openapi.json", sendOpenApi);
/** Alias — same OpenAPI document (source of truth remains openapi.json + enrich). */
openapiRouter.get("/swagger.json", sendOpenApi);

/** Shared handler for explicit app.get registration. */
export { sendOpenApi };
