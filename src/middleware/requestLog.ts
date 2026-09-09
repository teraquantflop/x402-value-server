import type { NextFunction, Request, Response } from "express";
import {
  buildAccessLogLine,
  classifyPayment,
  networkFromPaymentResponseHeader,
} from "./accessLog.js";
import {
  getRequestId,
  type RequestWithId,
} from "./security.js";

function isPlainEmptyObject(body: unknown): boolean {
  return (
    body !== null &&
    typeof body === "object" &&
    !Array.isArray(body) &&
    Object.keys(body as object).length === 0
  );
}

/**
 * Request logging:
 * - Enrich empty x402 402 JSON bodies for DX (no payTo in body).
 * - Emit one structured JSON access line on response finish (Flow-joinable).
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

    return originalJson(body);
  }) as Response["json"];

  res.on("finish", () => {
    const status = res.statusCode || 0;
    const ms = Date.now() - start;
    const requestId = getRequestId(req as unknown as RequestWithId);
    const paymentHeader = res.getHeader("PAYMENT-RESPONSE") ??
      res.getHeader("payment-response") ??
      res.getHeader("X-PAYMENT-RESPONSE") ??
      res.getHeader("x-payment-response");
    const hasPaymentResponse = Boolean(
      (typeof paymentHeader === "string" && paymentHeader.length > 0) ||
        (Array.isArray(paymentHeader) && paymentHeader.length > 0),
    );

    const payment = classifyPayment({
      status,
      path: req.path,
      method: req.method,
      hasPaymentResponse,
    });

    const network =
      payment === "settled" ? networkFromPaymentResponseHeader(res) : null;

    const uaRaw = req.get("user-agent");
    const uaApp =
      typeof uaRaw === "string" && uaRaw.trim().length > 0
        ? uaRaw.trim().slice(0, 256)
        : null;

    const line = buildAccessLogLine({
      requestId,
      method: req.method,
      path: req.path,
      status,
      ms,
      payment,
      network,
      uaApp,
    });

    // Single JSON line — join Railway Network Flow on requestId
    const payload = JSON.stringify(line);
    if (status >= 500) {
      console.error(payload);
    } else if (status >= 400) {
      console.warn(payload);
    } else {
      console.log(payload);
    }
  });

  next();
}
