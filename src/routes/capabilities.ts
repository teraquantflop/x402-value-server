import { Router } from "express";
import { config } from "../config.js";
import { buildCapabilities } from "../discovery/capabilities.js";

export const capabilitiesRouter = Router();

/**
 * GET /v1/capabilities — free machine matrix (models, units, caps, networks, prices).
 * No wallets / payTo.
 */
capabilitiesRouter.get("/v1/capabilities", (_req, res) => {
  res
    .status(200)
    .type("application/json")
    .setHeader("Cache-Control", "public, max-age=60")
    .json(buildCapabilities(config));
});
