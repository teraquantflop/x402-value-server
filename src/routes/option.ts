import { Router } from "express";
import { optionInputSchema } from "../schemas/option.js";
import {
  TimelineError,
  priceOptionDispatch,
} from "../services/priceDispatch.js";
import { getRequestId } from "../middleware/security.js";
import { HttpError } from "../middleware/errorHandler.js";

export const optionRouter = Router();

/**
 * POST /v1/option/price
 * Protected by x402 paymentMiddleware (mounted in app.ts).
 * Zod runs only after payment (or free-tier / SKIP_PAYMENT).
 */
optionRouter.post("/v1/option/price", (req, res, next) => {
  try {
    const parsed = optionInputSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(
        400,
        "validation_error",
        "Invalid option inputs",
        parsed.error.flatten(),
      );
    }

    const requestId = getRequestId(req);
    try {
      const result = priceOptionDispatch(parsed.data, { requestId });
      res.status(200).json(result);
    } catch (err) {
      if (err instanceof TimelineError) {
        throw new HttpError(400, err.code, err.message);
      }
      throw err;
    }
  } catch (err) {
    next(err);
  }
});
