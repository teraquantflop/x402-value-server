import { Router } from "express";
import { impliedVolInputSchema } from "../schemas/impliedVol.js";
import { solveImpliedVol } from "../services/impliedVol.js";
import { TimelineError } from "../services/timeline.js";
import { getRequestId } from "../middleware/security.js";
import { HttpError } from "../middleware/errorHandler.js";

export const impliedVolRouter = Router();

/**
 * POST /v1/option/implied-vol
 * Protected by x402 paymentMiddleware (mounted in app.ts), unless SKIP_PAYMENT=1.
 * Zod runs only after payment (or free-tier / SKIP_PAYMENT).
 */
impliedVolRouter.post("/v1/option/implied-vol", (req, res, next) => {
  const requestId = getRequestId(req);
  try {
    const parsed = impliedVolInputSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(
        400,
        "validation_error",
        "Invalid implied-vol inputs",
        parsed.error.flatten(),
      );
    }

    let result;
    try {
      result = solveImpliedVol(parsed.data, requestId);
    } catch (err) {
      if (err instanceof TimelineError) {
        throw new HttpError(400, err.code, err.message);
      }
      throw err;
    }

    if (!result.converged) {
      throw new HttpError(
        422,
        "iv_solve_failed",
        result.reason
          ? `Implied volatility solve failed: ${result.reason}`
          : "Implied volatility solve failed",
        {
          iterations: result.iterations,
          modelPrice: result.modelPrice,
          priceError: result.priceError,
          reason: result.reason,
        },
      );
    }

    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});
