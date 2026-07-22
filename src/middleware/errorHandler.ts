import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";
import { config } from "../config.js";

export class HttpError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json({
    error: "not_found",
    message: "Route not found",
  });
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: "validation_error",
      message: "Invalid request body",
      details: err.flatten(),
    });
    return;
  }

  if (err instanceof HttpError) {
    res.status(err.statusCode).json({
      error: err.code,
      message: err.message,
      ...(err.details !== undefined ? { details: err.details } : {}),
    });
    return;
  }

  // express.json syntax errors
  if (err instanceof SyntaxError && "body" in err) {
    res.status(400).json({
      error: "invalid_json",
      message: "Request body must be valid JSON",
    });
    return;
  }

  console.error("[error]", err);

  res.status(500).json({
    error: "internal_error",
    message:
      config.nodeEnv === "production"
        ? "Internal server error"
        : err instanceof Error
          ? err.message
          : "Unknown error",
  });
};
