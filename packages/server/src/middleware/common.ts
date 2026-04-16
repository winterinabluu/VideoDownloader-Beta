import type { Context, MiddlewareHandler } from "hono";
import { AppError } from "../errors.js";
import { ErrorCodes } from "@vd/shared";

/**
 * Global error handler - converts AppError and unknown errors into API responses.
 */
export async function errorHandler(
  err: Error,
  c: Context,
): Promise<Response> {
  if (err instanceof AppError) {
    console.error(`[${err.code}] ${err.message}`, err.detail ?? "");
    return c.json({ ok: false, error: err.toApiError() }, err.status as 400);
  }

  console.error("Unhandled error:", err);

  const error = new AppError(
    ErrorCodes.INTERNAL_ERROR,
    "An unexpected error occurred",
    { detail: err.message },
  );
  return c.json({ ok: false, error: error.toApiError() }, 500);
}

/**
 * Logger middleware - logs request method, path, status, and duration.
 */
export function logger(): MiddlewareHandler {
  return async (c, next) => {
    const start = Date.now();
    await next();
    const ms = Date.now() - start;
    const status = c.res.status;
    console.log(`${c.req.method} ${c.req.path} ${status} ${ms}ms`);
  };
}
