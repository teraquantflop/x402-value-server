import { Router, type Request, type Response } from "express";
import { config } from "../config.js";
import {
  buildWellKnownAgent,
  buildWellKnownX402,
  buildWellKnownX402Resources,
} from "../discovery/catalog.js";

/**
 * Root-level x402 / agent discovery documents.
 *   GET /.well-known/x402
 *   GET /.well-known/x402.json
 *   GET /.well-known/agent.json
 *   GET /.well-known/x402-resources
 */
export const wellKnownRouter = Router();

function sendJson(res: Response, body: unknown): void {
  res
    .status(200)
    .type("application/json")
    .setHeader("Cache-Control", "public, max-age=60")
    .json(body);
}

function sendWellKnownX402(_req: Request, res: Response): void {
  sendJson(res, buildWellKnownX402(config));
}

function sendWellKnownAgent(_req: Request, res: Response): void {
  sendJson(res, buildWellKnownAgent(config));
}

function sendWellKnownResources(_req: Request, res: Response): void {
  sendJson(res, buildWellKnownX402Resources(config));
}

wellKnownRouter.get("/.well-known/x402", sendWellKnownX402);
wellKnownRouter.get("/.well-known/x402.json", sendWellKnownX402);
wellKnownRouter.get("/.well-known/agent.json", sendWellKnownAgent);
wellKnownRouter.get("/.well-known/x402-resources", sendWellKnownResources);

export {
  sendWellKnownX402,
  sendWellKnownAgent,
  sendWellKnownResources,
};
