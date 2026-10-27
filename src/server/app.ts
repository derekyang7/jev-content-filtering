import { Hono } from "hono";
import {
  createModerator,
  type Moderator,
  type ModeratorOptions
} from "../core/moderator.js";
import {
  MODERATION_SURFACES,
  POLICY_PROFILES,
  type ModerationSurface,
  type PolicyProfileName
} from "../core/types.js";
import { createAuthMiddleware } from "./middleware/auth.js";
import {
  createRateLimitMiddleware,
  type RateLimitOptions
} from "./middleware/rate-limit.js";

export interface CreateAppOptions {
  apiKeys?: string;
  maxTextLength?: number;
  maxContextLength?: number;
  rateLimit?: RateLimitOptions;
  moderator?: Moderator;
  moderatorOptions?: ModeratorOptions;
}

const VALID_SURFACES = new Set<string>(MODERATION_SURFACES);
const VALID_PROFILES = new Set<string>(POLICY_PROFILES);

export function createApp(options: CreateAppOptions = {}): Hono {
  const app = new Hono();
  const maxTextLength =
    options.maxTextLength ?? Number(process.env.MAX_TEXT_LENGTH ?? 2_000);
  const maxContextLength = options.maxContextLength ?? 500;
  const moderator =
    options.moderator ?? createModerator(options.moderatorOptions);

  app.get("/health", (c) => c.json({ status: "ok" }));

  app.use("/v1/*", createAuthMiddleware(options.apiKeys));
  app.use("/v1/*", createRateLimitMiddleware(options.rateLimit));

  app.post("/v1/moderate", async (c) => {
    let body: Record<string, unknown>;
    try {
      body = (await c.req.json()) as Record<string, unknown>;
    } catch {
      return c.json({ error: "Invalid JSON request body" }, 400);
    }

    if (typeof body.text !== "string") {
      return c.json({ error: "Field 'text' is required and must be a string" }, 400);
    }

    if (body.text.length > maxTextLength) {
      return c.json(
        {
          error: `Field 'text' exceeds maximum length of ${maxTextLength} characters`
        },
        400
      );
    }

    if (body.context !== undefined) {
      if (typeof body.context !== "string") {
        return c.json({ error: "Field 'context' must be a string" }, 400);
      }
      if (body.context.length > maxContextLength) {
        return c.json(
          {
            error: `Field 'context' exceeds maximum length of ${maxContextLength} characters`
          },
          400
        );
      }
    }

    if (
      body.surface !== undefined &&
      (typeof body.surface !== "string" || !VALID_SURFACES.has(body.surface))
    ) {
      return c.json(
        {
          error: `Field 'surface' must be one of: ${MODERATION_SURFACES.join(", ")}`
        },
        400
      );
    }

    if (
      body.profile !== undefined &&
      (typeof body.profile !== "string" || !VALID_PROFILES.has(body.profile))
    ) {
      return c.json(
        {
          error: `Field 'profile' must be one of: ${POLICY_PROFILES.join(", ")}`
        },
        400
      );
    }

    const result = await moderator.moderate({
      text: body.text,
      surface: body.surface as ModerationSurface | undefined,
      profile: body.profile as PolicyProfileName | undefined,
      context: body.context as string | undefined
    });

    return c.json(result, 200);
  });

  return app;
}
