/**
 * HEAD stubs for paid paths (no pricing / IV / settle).
 * Unpaid HEAD is answered 402 by x402 paymentMiddleware when HEAD routes are
 * registered via withHeadChallenges. These handlers only run if payment is
 * skipped or a client somehow clears the gate — still no model work.
 */
import { Router, type Request, type Response } from "express";

export function createPaidHeadRouter(paths: string[]): Router {
  const router = Router();
  for (const path of paths) {
    router.head(path, (_req: Request, res: Response) => {
      res.setHeader("Allow", "POST");
      res.status(204).end();
    });
  }
  return router;
}

/** Ensure Allow: POST on HEAD to paid paths (including 402 challenge responses). */
export function allowPostOnPaidHead(paths: ReadonlySet<string>) {
  return (req: Request, res: Response, next: () => void): void => {
    if (req.method === "HEAD" && paths.has(req.path)) {
      res.setHeader("Allow", "POST");
    }
    next();
  };
}
