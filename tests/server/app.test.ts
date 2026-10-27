import { describe, expect, it, vi } from "vitest";
import { createZeroScores } from "../../src/core/prefilter.js";
import { createApp } from "../../src/server/app.js";

function createTestApp(options: {
  apiKeys?: string;
  maxRequests?: number;
  maxTextLength?: number;
} = {}) {
  const mockEvaluator = {
    evaluate: vi.fn(async () => ({
      ...createZeroScores(),
      harassment: 0.1
    }))
  };

  const app = createApp({
    apiKeys: options.apiKeys ?? "ios_app:secret_123",
    maxTextLength: options.maxTextLength ?? 2_000,
    rateLimit: {
      maxRequests: options.maxRequests ?? 60,
      windowMs: 60_000
    },
    moderatorOptions: {
      jevEvaluator: mockEvaluator
    }
  });

  return { app, mockEvaluator };
}

describe("Hono moderation server", () => {
  it("GET /health returns 200 OK without requiring auth", async () => {
    const { app } = createTestApp();
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("POST /v1/moderate rejects missing or invalid API keys with 401", async () => {
    const { app } = createTestApp({ apiKeys: "ios_app:secret_123" });

    const missingKeyRes = await app.request("/v1/moderate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "hello" })
    });
    expect(missingKeyRes.status).toBe(401);

    const wrongKeyRes = await app.request("/v1/moderate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": "wrong_key"
      },
      body: JSON.stringify({ text: "hello" })
    });
    expect(wrongKeyRes.status).toBe(401);
  });

  it("POST /v1/moderate validates request payload and returns 400 on invalid inputs", async () => {
    const { app } = createTestApp({
      apiKeys: "ios_app:secret_123",
      maxTextLength: 20
    });

    const tooLongRes = await app.request("/v1/moderate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": "secret_123"
      },
      body: JSON.stringify({ text: "this string is longer than twenty chars" })
    });
    expect(tooLongRes.status).toBe(400);

    const badSurfaceRes = await app.request("/v1/moderate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer secret_123"
      },
      body: JSON.stringify({ text: "hello", surface: "invalid_surface" })
    });
    expect(badSurfaceRes.status).toBe(400);
  });

  it("POST /v1/moderate returns 200 OK with ModerationResult for valid requests", async () => {
    const { app } = createTestApp({ apiKeys: "ios_app:secret_123" });

    const res = await app.request("/v1/moderate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": "secret_123"
      },
      body: JSON.stringify({
        text: "Great photo, thanks for sharing!",
        surface: "comment"
      })
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.flagged).toBe(false);
    expect(body.action).toBe("allow");
    expect(body.meta.surface).toBe("comment");
    expect(body.meta.profile).toBe("standard");
  });

  it("POST /v1/moderate enforces sliding-window rate limits with 429 Too Many Requests", async () => {
    const { app } = createTestApp({
      apiKeys: "ios_app:secret_123",
      maxRequests: 2
    });

    for (let i = 0; i < 2; i++) {
      const okRes = await app.request("/v1/moderate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": "secret_123"
        },
        body: JSON.stringify({ text: `message ${i}` })
      });
      expect(okRes.status).toBe(200);
    }

    const limitedRes = await app.request("/v1/moderate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": "secret_123"
      },
      body: JSON.stringify({ text: "message 3" })
    });
    expect(limitedRes.status).toBe(429);
    expect(limitedRes.headers.get("Retry-After")).toBeTruthy();
  });
});
