/**
 * JSON body parsing that does not short-circuit paid routes before x402.
 *
 * Malformed JSON is stashed on res.locals instead of failing immediately.
 * Payment middleware can then return 402 for unpaid paid-routes.
 * After payment (or free-tier / SKIP_PAYMENT), rejectStashedJsonError
 * surfaces the SyntaxError as 400 invalid_json via errorHandler.
 */
import express, {
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from "express";

export function deferredJsonParser(limit = "256kb"): RequestHandler {
  const parse = express.json({ limit });

  return (req: Request, res: Response, next: NextFunction): void => {
    parse(req, res, (err: unknown) => {
      if (err instanceof SyntaxError && err && "body" in err) {
        res.locals.jsonParseError = err;
        // Ensure handlers see a defined body if they somehow run
        if (req.body === undefined) {
          req.body = {};
        }
        next();
        return;
      }
      next(err as Error | undefined);
    });
  };
}

/**
 * After payment gate: fail requests whose body was not valid JSON.
 * Unpaid paid-routes never reach here (paymentMiddleware already 402'd).
 */
export function rejectStashedJsonError(
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.locals.jsonParseError) {
    next(res.locals.jsonParseError as Error);
    return;
  }
  next();
}
