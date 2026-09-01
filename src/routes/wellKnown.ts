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
 *   GET /.well-known/agent-card.json  (A2A alias — same body as agent.json)
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

/** Non-GET on agent-card: 405 + Allow: GET (crawlers must not POST). */
function rejectAgentCardNonGet(req: Request, res: Response): void {
  res
    .status(405)
    .setHeader("Allow", "GET")
    .type("application/json")
    .json({
      error: "method_not_allowed",
      message: "Use GET for the agent card.",
      method: req.method,
      path: "/.well-known/agent-card.json",
    });
}

wellKnownRouter.get("/.well-known/x402", sendWellKnownX402);
wellKnownRouter.get("/.well-known/x402.json", sendWellKnownX402);
wellKnownRouter.get("/.well-known/agent.json", sendWellKnownAgent);
wellKnownRouter.get("/.well-known/agent-card.json", sendWellKnownAgent);
wellKnownRouter.post("/.well-known/agent-card.json", rejectAgentCardNonGet);
wellKnownRouter.all("/.well-known/agent-card.json", rejectAgentCardNonGet);
wellKnownRouter.get("/.well-known/x402-resources", sendWellKnownResources);

export {
  sendWellKnownX402,
  sendWellKnownAgent,
  sendWellKnownResources,
};
