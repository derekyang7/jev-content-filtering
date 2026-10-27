import { createHash } from "node:crypto";
import type {
  ModerationResult,
  ModerationSurface,
  PolicyProfileName
} from "./types.js";

export type CachedEvaluation = Pick<
  ModerationResult,
  "flagged" | "action" | "reasons" | "scores"
>;

export interface CacheStore {
  get(key: string): CachedEvaluation | undefined;
  set(key: string, value: CachedEvaluation): void;
  clear(): void;
}

export interface LruCacheOptions {
  maxEntries?: number;
  ttlMs?: number;
}

export function buildCacheKey(params: {
  profile: PolicyProfileName;
  surface: ModerationSurface;
  canonicalKeyText: string;
  canonicalContext?: string;
}): string {
  const payload = JSON.stringify([
    params.profile,
    params.surface,
    params.canonicalKeyText,
    params.canonicalContext ?? ""
  ]);
  return createHash("sha256").update(payload).digest("hex");
}

interface CacheEntry {
  value: CachedEvaluation;
  expiresAt: number;
}

export class InMemoryLruCache implements CacheStore {
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly store = new Map<string, CacheEntry>();

  constructor(options: LruCacheOptions = {}) {
    this.maxEntries = options.maxEntries ?? 5_000;
    this.ttlMs = options.ttlMs ?? 3_600_000;
  }

  get(key: string): CachedEvaluation | undefined {
    const entry = this.store.get(key);
    if (!entry) {
      return undefined;
    }

    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }

    // Refresh LRU order
    this.store.delete(key);
    this.store.set(key, entry);

    return {
      flagged: entry.value.flagged,
      action: entry.value.action,
      reasons: [...entry.value.reasons],
      scores: { ...entry.value.scores }
    };
  }

  set(key: string, value: CachedEvaluation): void {
    if (this.store.has(key)) {
      this.store.delete(key);
    } else if (this.store.size >= this.maxEntries) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) {
        this.store.delete(oldestKey);
      }
    }

    this.store.set(key, {
      value: {
        flagged: value.flagged,
        action: value.action,
        reasons: [...value.reasons],
        scores: { ...value.scores }
      },
      expiresAt: Date.now() + this.ttlMs
    });
  }

  clear(): void {
    this.store.clear();
  }
}
