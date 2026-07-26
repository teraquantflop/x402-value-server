import { Router, type Request, type Response } from "express";
import { config } from "../config.js";
import { buildLlmsTxt } from "../discovery/llmsTxt.js";

export const llmsTxtRouter = Router();

/**
 * GET /llms.txt — free agent discovery document (Markdown as text/plain).
 */
export function sendLlmsTxt(_req: Request, res: Response): void {
  const body = buildLlmsTxt(config);
  res
    .status(200)
    .type("text/plain; charset=utf-8")
    .setHeader("Cache-Control", "public, max-age=300")
    .send(body);
}

llmsTxtRouter.get("/llms.txt", sendLlmsTxt);
