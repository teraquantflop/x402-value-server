/**
 * Optional first-N free calls on POST /v1/option/price only.
 * In-memory per process — fine for single-replica Railway seeding.
 * FREE_TIER_N=0 disables (default).
 */
import type { NextFunction, Request, Response } from "express";
import type { AppConfig } from "../types.js";

interface Bucket {
  count: number;
  windowStart: number;
}

export class FreeTierStore {
  private readonly map = new Map<string, Bucket>();

  constructor(
    private readonly n: number,
    private readonly windowMs: number,
  ) {}

  /** Returns remaining free calls after consuming one, or null if not free. */
  tryConsume(key: string): { remaining: number } | null {
    if (this.n <= 0) return null;
    const now = Date.now();
    let b = this.map.get(key);
    if (!b || now - b.windowStart > this.windowMs) {
      b = { count: 0, windowStart: now };
      this.map.set(key, b);
    }
    if (b.count >= this.n) return null;
    b.count += 1;
    return { remaining: Math.max(0, this.n - b.count) };
  }
}

function clientKey(req: Request): string {
  const xf = req.headers["x-forwarded-for"];
  if (typeof xf === "string" && xf.length > 0) {
    return xf.split(",")[0]!.trim();
  }
  return req.ip || req.socket.remoteAddress || "unknown";
}

/**
 * When free tier applies, marks the request so payment middleware can be skipped
 * for this path only via a short-circuit flag.
 *
 * Implementation: attach `res.locals.freeTierGranted` and skip payment by
 * mounting a path-specific gate that runs BEFORE paymentMiddleware.
 */
export function freeTierMiddleware(config: AppConfig) {
  const store = new FreeTierStore(config.freeTierN, config.freeTierWindowMs);

  return (req: Request, res: Response, next: NextFunction): void => {
    if (config.freeTierN <= 0) {
      next();
      return;
    }
    if (req.method !== "POST" || req.path !== "/v1/option/price") {
      next();
      return;
    }
    const result = store.tryConsume(clientKey(req));
    if (!result) {
      next();
      return;
    }
    res.locals.freeTierGranted = true;
    res.locals.freeTierRemaining = result.remaining;
    res.setHeader("X-Free-Tier-Remaining", String(result.remaining));
    res.setHeader("X-Free-Tier", "1");
    next();
  };
}

/**
 * Skip x402 payment when free tier was granted, or when OptionBookClient matched.
 * Wrapper calls next() without invoking payment when exempt.
 */
export function skipPaymentIfFreeTier(
  paymentMw: (req: Request, res: Response, next: NextFunction) => void,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (res.locals.freeTierGranted === true) {
      next();
      return;
    }
    if (res.locals.optionBookClient === true) {
      next();
      return;
    }
    paymentMw(req, res, next);
  };
}
