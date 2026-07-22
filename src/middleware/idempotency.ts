import { createHash } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

export interface CachedResponse {
  statusCode: number;
  body: unknown;
  createdAt: number;
}

export interface IdempotencyStore {
  get(key: string): CachedResponse | undefined;
  set(key: string, value: CachedResponse): void;
}

/** Simple in-memory TTL store. Swap for Redis in multi-instance deploys. */
export class MemoryIdempotencyStore implements IdempotencyStore {
  private readonly map = new Map<string, CachedResponse>();

  constructor(private readonly ttlMs: number) {}

  get(key: string): CachedResponse | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.createdAt > this.ttlMs) {
      this.map.delete(key);
      return undefined;
    }
    return entry;
  }

  set(key: string, value: CachedResponse): void {
    this.map.set(key, value);
    // Opportunistic prune
    if (this.map.size > 10_000) {
      const now = Date.now();
      for (const [k, v] of this.map) {
        if (now - v.createdAt > this.ttlMs) {
          this.map.delete(k);
        }
      }
    }
  }
}

function resolveKey(req: Request): string | null {
  const headerKey = req.header("idempotency-key")?.trim();
  if (headerKey && headerKey.length > 0 && headerKey.length <= 256) {
    return `idemp:${headerKey}`;
  }

  // Fallback: payment signature header (x402 v2 uses PAYMENT-SIGNATURE)
  const payment =
    req.header("payment-signature") ??
    req.header("PAYMENT-SIGNATURE") ??
    req.header("x-payment");
  if (payment && payment.length > 0) {
    const hash = createHash("sha256").update(payment).digest("hex");
    return `pay:${hash}`;
  }

  return null;
}

/**
 * Caches successful JSON responses for safe client retries.
 * On-chain x402 authorizations are already single-use; this protects app responses.
 */
export function idempotencyMiddleware(store: IdempotencyStore) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = resolveKey(req);
    if (!key) {
      next();
      return;
    }

    const cached = store.get(key);
    if (cached) {
      res.setHeader("Idempotent-Replay", "true");
      res.status(cached.statusCode).json(cached.body);
      return;
    }

    const originalJson = res.json.bind(res);
    res.json = ((body: unknown) => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        store.set(key, {
          statusCode: res.statusCode,
          body,
          createdAt: Date.now(),
        });
      }
      return originalJson(body);
    }) as Response["json"];

    next();
  };
}
