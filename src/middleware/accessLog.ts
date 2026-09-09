/**
 * Structured access-log helpers (Railway Network Flow joinable on requestId).
 * Flow.clientUa is UA source of truth; uaApp here is an optional hint only.
 */
import type { Request, Response } from "express";

export type PaymentOutcome = "free" | "challenge" | "settled" | "other";

export type AccessLogLine = {
  ts: string;
  requestId: string;
  method: string;
  path: string;
  status: number;
  ms: number;
  payment: PaymentOutcome;
  network: string | null;
  uaApp: string | null;
};

/** Paid compute paths (not discovery / demo). */
export function isPaidHttpPath(path: string): boolean {
  if (path.startsWith("/v1/demo")) return false;
  return (
    path.startsWith("/v1/option/") ||
    path.startsWith("/v1/volatility/") ||
    path.startsWith("/v1/portfolio/")
  );
}

function headerFirst(
  res: Response,
  names: string[],
): string | undefined {
  for (const n of names) {
    const v = res.getHeader(n);
    if (typeof v === "string" && v.length > 0) return v;
    if (Array.isArray(v) && typeof v[0] === "string" && v[0].length > 0) {
      return v[0];
    }
  }
  return undefined;
}

/**
 * Best-effort settlement network from PAYMENT-RESPONSE (never log payTo).
 */
export function networkFromPaymentResponseHeader(
  res: Response,
): string | null {
  const raw = headerFirst(res, [
    "PAYMENT-RESPONSE",
    "payment-response",
    "X-PAYMENT-RESPONSE",
    "x-payment-response",
  ]);
  if (!raw) return null;
  try {
    const decoded = JSON.parse(
      Buffer.from(raw, "base64").toString("utf8"),
    ) as { network?: unknown };
    if (typeof decoded.network === "string" && decoded.network.length > 0) {
      return decoded.network;
    }
  } catch {
    try {
      const decoded = JSON.parse(raw) as { network?: unknown };
      if (typeof decoded.network === "string" && decoded.network.length > 0) {
        return decoded.network;
      }
    } catch {
      // ignore
    }
  }
  return null;
}

export function classifyPayment(opts: {
  status: number;
  path: string;
  method: string;
  hasPaymentResponse: boolean;
}): PaymentOutcome {
  if (opts.status === 402) return "challenge";

  if (opts.status >= 200 && opts.status < 300) {
    if (
      isPaidHttpPath(opts.path) &&
      opts.method === "POST" &&
      opts.hasPaymentResponse
    ) {
      return "settled";
    }
    // Discovery, demo, SKIP_PAYMENT/free-tier success, HEAD stubs, etc.
    return "free";
  }

  return "other";
}

export function buildAccessLogLine(opts: {
  requestId: string;
  method: string;
  path: string;
  status: number;
  ms: number;
  payment: PaymentOutcome;
  network: string | null;
  uaApp: string | null;
  now?: Date;
}): AccessLogLine {
  return {
    ts: (opts.now ?? new Date()).toISOString(),
    requestId: opts.requestId,
    method: opts.method,
    path: opts.path,
    status: opts.status,
    ms: opts.ms,
    payment: opts.payment,
    network: opts.network,
    uaApp: opts.uaApp,
  };
}

/** Reject log lines that accidentally contain wallet-shaped secrets. */
export function accessLogLooksSafe(line: AccessLogLine): boolean {
  const s = JSON.stringify(line);
  if (/0x[a-fA-F0-9]{40}/.test(s)) return false;
  if (/"payto"/i.test(s)) return false;
  return true;
}

export function resolveRequestIdFromHeaders(req: Request): string | undefined {
  const railway = req.header("x-railway-request-id")?.trim();
  if (railway && railway.length > 0 && railway.length <= 128) return railway;
  const incoming = req.header("x-request-id")?.trim();
  if (incoming && incoming.length > 0 && incoming.length <= 128) return incoming;
  return undefined;
}
