import type { MiddlewareHandler } from "hono";

interface RateLimitOptions {
  windowMs: number;
  max: number;
  keyFn?: (c: Parameters<MiddlewareHandler>[0]) => string;
}

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Simple in-memory fixed-window rate limiter.
 * Keyed by client IP by default.
 */
export function rateLimit(options: RateLimitOptions): MiddlewareHandler {
  const buckets = new Map<string, Bucket>();

  // Periodic cleanup to prevent unbounded growth
  setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt < now) buckets.delete(key);
    }
  }, options.windowMs).unref?.();

  return async (c, next) => {
    const key =
      options.keyFn?.(c) ??
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
      c.req.header("x-real-ip") ??
      "unknown";

    const now = Date.now();
    let bucket = buckets.get(key);

    if (!bucket || bucket.resetAt < now) {
      bucket = { count: 0, resetAt: now + options.windowMs };
      buckets.set(key, bucket);
    }

    bucket.count++;

    if (bucket.count > options.max) {
      return c.json(
        {
          ok: false,
          error: {
            code: "RATE_LIMITED",
            message: "Too many requests, please try again later",
          },
        },
        429,
      );
    }

    await next();
  };
}
