import { Router } from "express";
import { volatilitySurfaceInputSchema } from "../schemas/volatility.js";
import { buildVolatilitySurface } from "../services/volatilitySurface.js";
import { getRequestId } from "../middleware/security.js";
import { HttpError } from "../middleware/errorHandler.js";

export const volatilityRouter = Router();

/**
 * POST /v1/volatility/surface
 * Protected by x402 paymentMiddleware (mounted in app.ts), unless SKIP_PAYMENT=1.
 */
volatilityRouter.post("/v1/volatility/surface", (req, res, next) => {
  const requestId = getRequestId(req);
  try {
    const parsed = volatilitySurfaceInputSchema.safeParse(req.body);
    if (!parsed.success) {
      console.warn(
        `[volatility/surface] validation failed requestId=${requestId}`,
        parsed.error.flatten(),
      );
      throw new HttpError(
        400,
        "validation_error",
        "Invalid volatility surface inputs",
        parsed.error.flatten(),
      );
    }

    const { rate, dividendYield, options } = parsed.data;
    console.log(
      `[volatility/surface] compute requestId=${requestId} options=${options.length} rate=${rate} q=${dividendYield}`,
    );

    const result = buildVolatilitySurface(
      { rate, dividendYield },
      options,
      requestId,
    );

    console.log(
      `[volatility/surface] ok requestId=${requestId} okCount=${result.fit.okCount} failed=${result.fit.failedCount} ms=${result.stats.elapsedMs}`,
    );

    if (!result.surface || !Array.isArray(result.points)) {
      console.error(
        `[volatility/surface] unexpected empty result requestId=${requestId}`,
        result,
      );
      throw new HttpError(
        500,
        "internal_error",
        "Surface computation produced an empty result",
      );
    }

    res.status(200).json(result);
  } catch (err) {
    console.error(
      `[volatility/surface] error requestId=${requestId}`,
      err instanceof Error ? err.message : err,
    );
    next(err);
  }
});
