import { Router, type Request, type Response } from "express";
import { config } from "../config.js";
import { buildSkillMd } from "../discovery/skillMd.js";

export const skillMdRouter = Router();

/** GET /skill.md | /SKILL.md — free agent skill loader document. */
export function sendSkillMd(_req: Request, res: Response): void {
  const body = buildSkillMd(config);
  res
    .status(200)
    .type("text/markdown; charset=utf-8")
    .setHeader("Cache-Control", "public, max-age=300")
    .send(body);
}

skillMdRouter.get("/skill.md", sendSkillMd);
skillMdRouter.get("/SKILL.md", sendSkillMd);
