import { Router } from "express";
import { optionInputSchema } from "../schemas/option.js";
import { priceWithGreeks } from "../services/blackScholes.js";
import { getRequestId } from "../middleware/security.js";
import { HttpError } from "../middleware/errorHandler.js";

export const optionRouter = Router();

/**
 * POST /v1/option/price
 * Protected by x402 paymentMiddleware (mounted in app.ts).
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
    const result = priceWithGreeks(parsed.data, requestId);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});
