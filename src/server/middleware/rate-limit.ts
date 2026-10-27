import type { MiddlewareHandler } from "hono";

export interface RateLimitOptions {
  maxRequests?: number;
  windowMs?: number;
}

export function createRateLimitMiddleware(
  options: RateLimitOptions = {}
): MiddlewareHandler {
  const maxRequests =
    options.maxRequests ?? Number(process.env.RATE_LIMIT_MAX ?? 60);
  const windowMs =
    options.windowMs ?? Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000);
  const buckets = new Map<string, number[]>();

  return async (c, next) => {
    const now = Date.now();
    const apiKey =
      c.req.header("X-API-Key") ?? c.req.header("Authorization") ?? "anon";
    const clientIp =
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
    const bucketKey = `${apiKey}:${clientIp}`;

    const timestamps = (buckets.get(bucketKey) ?? []).filter(
      (ts) => now - ts < windowMs
    );

    if (timestamps.length >= maxRequests) {
      const oldest = timestamps[0] ?? now;
      const retryAfterSec = Math.max(
        1,
        Math.ceil((windowMs - (now - oldest)) / 1_000)
      );
      c.header("Retry-After", String(retryAfterSec));
      return c.json({ error: "Too Many Requests: rate limit exceeded" }, 429);
    }

    timestamps.push(now);
    buckets.set(bucketKey, timestamps);

    await next();
  };
}
