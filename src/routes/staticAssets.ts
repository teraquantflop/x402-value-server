import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Router, type Request, type Response } from "express";

const PUBLIC_DIR = join(process.cwd(), "public");

function sendFile(
  res: Response,
  filename: string,
  contentType: string,
  maxAge = 86_400,
): void {
  const path = join(PUBLIC_DIR, filename);
  if (!existsSync(path)) {
    res.status(404).type("text/plain").send("Not found");
    return;
  }
  const body = readFileSync(path);
  res
    .status(200)
    .type(contentType)
    .setHeader("Cache-Control", `public, max-age=${maxAge}`)
    .send(body);
}

export const staticAssetsRouter = Router();

/** Prefer SVG for modern browsers; also serve at classic .ico path. */
staticAssetsRouter.get("/favicon.svg", (_req: Request, res: Response) => {
  sendFile(res, "favicon.svg", "image/svg+xml");
});

staticAssetsRouter.get("/favicon.ico", (_req: Request, res: Response) => {
  // Serve SVG as favicon when ICO is the SVG copy (lightweight, works in modern browsers)
  const ico = join(PUBLIC_DIR, "favicon.ico");
  const svg = join(PUBLIC_DIR, "favicon.svg");
  if (existsSync(ico)) {
    const body = readFileSync(ico);
    // Detect SVG content
    const isSvg =
      body.length > 4 && body.subarray(0, 5).toString("utf8").includes("svg");
    res
      .status(200)
      .type(isSvg ? "image/svg+xml" : "image/x-icon")
      .setHeader("Cache-Control", "public, max-age=86400")
      .send(body);
    return;
  }
  if (existsSync(svg)) {
    sendFile(res, "favicon.svg", "image/svg+xml");
    return;
  }
  res.status(404).end();
});

staticAssetsRouter.get("/favicon.png", (_req: Request, res: Response) => {
  sendFile(res, "favicon.png", "image/png");
});

staticAssetsRouter.get("/apple-touch-icon.png", (_req: Request, res: Response) => {
  sendFile(res, "favicon.png", "image/png");
});
