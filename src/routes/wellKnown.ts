import { Router, type Request, type Response } from "express";
import { config } from "../config.js";
import { buildWellKnownX402 } from "../discovery/catalog.js";

/**
 * Root-level x402 discovery documents.
 * Mounted at app root so paths are exactly:
 *   GET /.well-known/x402
 *   GET /.well-known/x402.json
 */
export const wellKnownRouter = Router();

function sendWellKnownX402(_req: Request, res: Response): void {
  res
    .status(200)
    .type("application/json")
    .setHeader("Cache-Control", "public, max-age=60")
    .json(buildWellKnownX402(config));
}

// Paths relative to mount point "/". Do not nest under another prefix.
wellKnownRouter.get("/.well-known/x402", sendWellKnownX402);
wellKnownRouter.get("/.well-known/x402.json", sendWellKnownX402);
