/**
 * Optional payment skip when OptionBookClient header matches OPTIONBOOK_ID.
 * Disabled when the env id is unset/empty. Never log the id or header value.
 */
import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import type { AppConfig } from "../types.js";

export function matchesOptionBookClient(
  expected: string | undefined,
  headerValue: string | undefined,
): boolean {
  if (!expected || expected.length === 0) return false;
  if (headerValue === undefined || headerValue === "") return false;
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(headerValue, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * If OPTIONBOOK_ID is configured and OptionBookClient matches, mark the
 * request so the payment gate can be skipped (same pattern as free tier).
 */
export function optionBookClientMiddleware(config: AppConfig) {
  const expected = config.optionBookId;

  return (req: Request, res: Response, next: NextFunction): void => {
    if (!expected) {
      next();
      return;
    }
    // Express normalizes header names to lowercase
    const raw = req.get("optionbookclient") ?? undefined;
    if (!matchesOptionBookClient(expected, raw)) {
      next();
      return;
    }
    res.locals.optionBookClient = true;
    next();
  };
}
