import {
  buildCacheKey,
  InMemoryLruCache,
  type CacheStore,
  type LruCacheOptions
} from "./cache.js";
import {
  TypeSafeJevEvaluator,
  type CreateJevEvaluatorOptions
} from "./jev-evaluator.js";
import { normalizeText } from "./normalize.js";
import {
  evaluateScoresAgainstProfile,
  resolveProfileForSurface
} from "./policies.js";
import {
  createZeroScores,
  runPrefilter,
  type PrefilterOptions
} from "./prefilter.js";
import type {
  JevEvaluator,
  ModerationRequest,
  ModerationResult,
  ModerationSurface
} from "./types.js";

export interface ModeratorOptions {
  cache?: CacheStore;
  cacheOptions?: LruCacheOptions;
  prefilterOptions?: PrefilterOptions;
  jevEvaluator?: JevEvaluator;
  jevOptions?: CreateJevEvaluatorOptions;
}

export interface Moderator {
  moderate(request: ModerationRequest): Promise<ModerationResult>;
}

export function createModerator(options: ModeratorOptions = {}): Moderator {
  const cache = options.cache ?? new InMemoryLruCache(options.cacheOptions);
  const evaluator =
    options.jevEvaluator ?? new TypeSafeJevEvaluator(options.jevOptions);

  return {
    async moderate(request: ModerationRequest): Promise<ModerationResult> {
      const startTime = performance.now();
      const surface: ModerationSurface = request.surface ?? "comment";
      const profile = resolveProfileForSurface(surface, request.profile);
      const normalized = normalizeText(request.text);

      // Tier 1: Deterministic Pre-Filter
      const prefilterDecision = runPrefilter(
        normalized,
        options.prefilterOptions
      );
      if (prefilterDecision.decided) {
        return {
          flagged: prefilterDecision.flagged ?? false,
          action: prefilterDecision.action ?? "allow",
          reasons: prefilterDecision.reasons ?? [],
          scores: prefilterDecision.scores ?? createZeroScores(),
          meta: {
            tier: "prefilter",
            profile,
            surface,
            cached: false,
            degraded: false,
            latencyMs: Math.round(performance.now() - startTime)
          }
        };
      }

      // Tier 2: Normalized Hash Cache
      const normalizedContext = request.context
        ? normalizeText(request.context).canonicalKeyText
        : "";
      const cacheKey = buildCacheKey({
        profile,
        surface,
        canonicalKeyText: normalized.canonicalKeyText,
        canonicalContext: normalizedContext
      });

      const cached = cache.get(cacheKey);
      if (cached) {
        return {
          flagged: cached.flagged,
          action: cached.action,
          reasons: cached.reasons,
          scores: cached.scores,
          meta: {
            tier: "cache",
            profile,
            surface,
            cached: true,
            degraded: false,
            latencyMs: Math.round(performance.now() - startTime)
          }
        };
      }

      // Tier 3: Single-Pass Jev Evaluation
      try {
        const scores = await evaluator.evaluate({
          surface,
          contentToEvaluate: normalized.cleanedText,
          parentContext: request.context?.trim() || undefined
        });

        const decision = evaluateScoresAgainstProfile(scores, profile);
        const evaluationResult = {
          flagged: decision.flagged,
          action: decision.action,
          reasons: decision.reasons,
          scores
        };

        cache.set(cacheKey, evaluationResult);

        return {
          ...evaluationResult,
          meta: {
            tier: "jev",
            profile,
            surface,
            cached: false,
            degraded: false,
            latencyMs: Math.round(performance.now() - startTime)
          }
        };
      } catch {
        // Degraded fallback: never cache transient errors
        return {
          flagged: true,
          action: "flag_for_review",
          reasons: [],
          scores: createZeroScores(),
          meta: {
            tier: "jev",
            profile,
            surface,
            cached: false,
            degraded: true,
            latencyMs: Math.round(performance.now() - startTime)
          }
        };
      }
    }
  };
}

const defaultModerator = createModerator();

export async function moderateContent(
  request: ModerationRequest,
  options?: ModeratorOptions
): Promise<ModerationResult> {
  const instance = options ? createModerator(options) : defaultModerator;
  return instance.moderate(request);
}
