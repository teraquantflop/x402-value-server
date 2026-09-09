/**
 * HEAD / GET helpers for paid paths (no pricing / IV / settle).
 * - Unpaid HEAD → 402 via x402 paymentMiddleware (withHeadChallenges).
 * - GET → 405 + Allow: POST (not a bare 404; not a payable GET).
 * HEAD stubs below only run if payment is skipped / cleared.
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

/** GET on paid POST-only routes: 405 + Allow: POST (scanner-friendly). */
export function createPaidGetRouter(paths: string[]): Router {
  const router = Router();
  for (const path of paths) {
    router.get(path, (req: Request, res: Response) => {
      res
        .status(405)
        .setHeader("Allow", "POST")
        .type("application/json")
        .json({
          error: "method_not_allowed",
          message: "This route accepts POST only (x402 USDC exact). Use POST.",
          method: req.method,
          path,
          allow: ["POST"],
        });
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
