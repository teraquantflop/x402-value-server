import type { NextFunction, Request, Response } from "express";

function isPlainEmptyObject(body: unknown): boolean {
  return (
    body !== null &&
    typeof body === "object" &&
    !Array.isArray(body) &&
    Object.keys(body as object).length === 0
  );
}

/**
 * Request logging + enrich empty x402 402 bodies so clients that only print
 * the JSON body still see a useful message (PAYMENT-REQUIRED remains in headers).
 */
export function requestLogMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const start = Date.now();
  const originalJson = res.json.bind(res);

  res.json = ((body: unknown) => {
    const status = res.statusCode || 200;
    const ms = Date.now() - start;

    // x402 middleware often sends res.status(402).json({}) — enrich for DX
    if (status === 402 && isPlainEmptyObject(body)) {
      body = {
        error: "payment_required",
        message:
          "x402 USDC payment required. Decode the PAYMENT-REQUIRED response header (base64 JSON) for amount, network, payTo, and asset. Body is empty by protocol default; this message is added by the server for readability.",
        path: req.path,
        method: req.method,
      };
    }

    if (status >= 500) {
      console.error(
        `[http] ${req.method} ${req.path} → ${status} ${ms}ms`,
        body,
      );
    } else if (status >= 400) {
      console.warn(
        `[http] ${req.method} ${req.path} → ${status} ${ms}ms`,
        typeof body === "object" && body && "error" in body
          ? (body as { error: string }).error
          : "",
      );
    } else {
      console.log(`[http] ${req.method} ${req.path} → ${status} ${ms}ms`);
    }

    return originalJson(body);
  }) as Response["json"];

  next();
}
