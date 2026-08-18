import { Router } from "express";
import {
  priceFromSurfaceInputSchema,
  scenarioFromSurfaceInputSchema,
} from "../schemas/surfacePricing.js";
import { priceFromSurface } from "../services/priceFromSurface.js";
import { scenarioFromSurface } from "../services/scenarioFromSurface.js";
import { SurfaceValidationError } from "../services/surfaceInterpolator.js";
import { getRequestId } from "../middleware/security.js";
import { HttpError } from "../middleware/errorHandler.js";

export const surfacePricingRouter = Router();

/**
 * POST /v1/option/price-from-surface
 * Zod runs only after payment (or free-tier / SKIP_PAYMENT).
 */
surfacePricingRouter.post(
  "/v1/option/price-from-surface",
  (req, res, next) => {
    const requestId = getRequestId(req);
    try {
      const parsed = priceFromSurfaceInputSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new HttpError(
          400,
          "validation_error",
          "Invalid price-from-surface inputs",
          parsed.error.flatten(),
        );
      }
      const result = priceFromSurface(parsed.data, requestId);
      res.status(200).json(result);
    } catch (err) {
      if (err instanceof SurfaceValidationError) {
        next(
          new HttpError(400, err.code, err.message),
        );
        return;
      }
      if (err instanceof Error && err.message.includes("underlyingRel")) {
        next(new HttpError(400, "validation_error", err.message));
        return;
      }
      next(err);
    }
  },
);

/**
 * POST /v1/option/scenario-from-surface
 * Zod runs only after payment (or free-tier / SKIP_PAYMENT).
 */
surfacePricingRouter.post(
  "/v1/option/scenario-from-surface",
  (req, res, next) => {
    const requestId = getRequestId(req);
    try {
      const parsed = scenarioFromSurfaceInputSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new HttpError(
          400,
          "validation_error",
          "Invalid scenario-from-surface inputs",
          parsed.error.flatten(),
        );
      }
      const result = scenarioFromSurface(parsed.data, requestId);
      res.status(200).json(result);
    } catch (err) {
      if (err instanceof SurfaceValidationError) {
        next(new HttpError(400, err.code, err.message));
        return;
      }
      if (
        err instanceof Error &&
        (err.message.includes("underlyingRel") ||
          err.message.includes("underlyingAbs"))
      ) {
        next(new HttpError(400, "validation_error", err.message));
        return;
      }
      next(err);
    }
  },
);
