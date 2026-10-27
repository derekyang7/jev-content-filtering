import { describe, expect, it, vi } from "vitest";
import { buildCacheKey, InMemoryLruCache } from "../../src/core/cache.js";
import { createZeroScores } from "../../src/core/prefilter.js";

describe("InMemoryLruCache and buildCacheKey", () => {
  it("produces identical SHA-256 keys for identical normalized inputs and distinct keys across profiles/surfaces", () => {
    const key1 = buildCacheKey({
      profile: "standard",
      surface: "comment",
      canonicalKeyText: "hello world"
    });
    const key2 = buildCacheKey({
      profile: "standard",
      surface: "comment",
      canonicalKeyText: "hello world"
    });
    const strictKey = buildCacheKey({
      profile: "strict",
      surface: "comment",
      canonicalKeyText: "hello world"
    });

    expect(key1).toBe(key2);
    expect(key1).not.toBe(strictKey);
  });

  it("stores, retrieves, and evicts least-recently-used entries when maxEntries is exceeded", () => {
    const cache = new InMemoryLruCache({ maxEntries: 2, ttlMs: 60_000 });
    const sample = {
      flagged: false,
      action: "allow" as const,
      reasons: [],
      scores: createZeroScores()
    };

    cache.set("k1", sample);
    cache.set("k2", sample);
    // Access k1 so k2 becomes the least-recently-used
    expect(cache.get("k1")).toEqual(sample);

    cache.set("k3", sample);
    expect(cache.get("k1")).toEqual(sample);
    expect(cache.get("k2")).toBeUndefined();
    expect(cache.get("k3")).toEqual(sample);
  });

  it("expires entries after ttlMs has elapsed", () => {
    vi.useFakeTimers();
    try {
      const cache = new InMemoryLruCache({ maxEntries: 10, ttlMs: 1_000 });
      const sample = {
        flagged: false,
        action: "allow" as const,
        reasons: [],
        scores: createZeroScores()
      };

      cache.set("k1", sample);
      expect(cache.get("k1")).toEqual(sample);

      vi.advanceTimersByTime(1_001);
      expect(cache.get("k1")).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
