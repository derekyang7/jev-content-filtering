import type { MiddlewareHandler } from "hono";

export function parseAllowedApiKeys(raw?: string): Set<string> {
  if (!raw || raw.trim().length === 0) {
    return new Set();
  }

  const keys = new Set<string>();
  for (const entry of raw.split(",")) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const colonIndex = trimmed.indexOf(":");
    const secret =
      colonIndex >= 0 ? trimmed.slice(colonIndex + 1).trim() : trimmed;
    if (secret) {
      keys.add(secret);
    }
  }
  return keys;
}

export function createAuthMiddleware(rawApiKeys?: string): MiddlewareHandler {
  const allowedKeys = parseAllowedApiKeys(
    rawApiKeys ?? process.env.MODERATION_API_KEYS
  );

  return async (c, next) => {
    if (allowedKeys.size === 0) {
      await next();
      return;
    }

    const headerKey = c.req.header("X-API-Key")?.trim();
    const authHeader = c.req.header("Authorization")?.trim();
    const bearerKey = authHeader?.toLowerCase().startsWith("bearer ")
      ? authHeader.slice(7).trim()
      : undefined;

    const providedKey = headerKey || bearerKey;
    if (!providedKey || !allowedKeys.has(providedKey)) {
      return c.json(
        { error: "Unauthorized: missing or invalid API key" },
        401
      );
    }

    await next();
  };
}
