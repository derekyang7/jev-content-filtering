import { describe, expect, it, vi } from "vitest";
import { createModerator } from "../../src/core/moderator.js";
import { createZeroScores } from "../../src/core/prefilter.js";
import type { CategoryScores, JevEvaluator } from "../../src/core/types.js";

function createMockEvaluator(
  scoresOrError: Partial<CategoryScores> | Error
): JevEvaluator & { evaluate: ReturnType<typeof vi.fn> } {
  return {
    evaluate: vi.fn(async () => {
      if (scoresOrError instanceof Error) {
        throw scoresOrError;
      }
      return {
        ...createZeroScores(),
        ...scoresOrError
      };
    })
  };
}

describe("createModerator pipeline orchestration", () => {
  it("short-circuits at Tier 1 (prefilter) without calling Jev", async () => {
    const evaluator = createMockEvaluator({});
    const moderator = createModerator({ jevEvaluator: evaluator });

    const res = await moderator.moderate({
      text: "you are a faggot",
      surface: "comment"
    });

    expect(res.flagged).toBe(true);
    expect(res.action).toBe("block");
    expect(res.reasons).toEqual(["hate_speech"]);
    expect(res.meta.tier).toBe("prefilter");
    expect(evaluator.evaluate).not.toHaveBeenCalled();
  });

  it("evaluates novel text via Tier 3 (Jev) and serves subsequent identical requests from Tier 2 (cache)", async () => {
    const evaluator = createMockEvaluator({
      harassment: 0.91,
      violence_or_threats: 0.12
    });
    const moderator = createModerator({ jevEvaluator: evaluator });

    const first = await moderator.moderate({
      text: "You are completely worthless and nobody likes you",
      surface: "comment"
    });

    expect(first.flagged).toBe(true);
    expect(first.action).toBe("block");
    expect(first.reasons).toEqual(["harassment"]);
    expect(first.meta.tier).toBe("jev");
    expect(first.meta.cached).toBe(false);
    expect(evaluator.evaluate).toHaveBeenCalledTimes(1);

    const second = await moderator.moderate({
      text: "  you are completely   worthless and nobody likes you  ",
      surface: "comment"
    });

    expect(second.flagged).toBe(true);
    expect(second.action).toBe("block");
    expect(second.meta.tier).toBe("cache");
    expect(second.meta.cached).toBe(true);
    expect(evaluator.evaluate).toHaveBeenCalledTimes(1);
  });

  it("applies surface-specific profile thresholds (username -> strict, comment -> standard, chat -> lenient)", async () => {
    // Score of 0.65 on harassment:
    // - strict (review: 0.40, block: 0.70) => flag_for_review
    // - standard (review: 0.50, block: 0.85) => flag_for_review
    // - lenient (review: 0.65, block: 0.90) => flag_for_review
    // Score of 0.62 on sexual_content:
    // - strict (review: 0.35, block: 0.60) => block
    // - standard (review: 0.50, block: 0.75) => flag_for_review
    // - lenient (review: 0.60, block: 0.85) => flag_for_review
    const evaluator = createMockEvaluator({
      sexual_content: 0.62
    });
    const moderator = createModerator({ jevEvaluator: evaluator });

    const usernameResult = await moderator.moderate({
      text: "steamy bio text",
      surface: "username"
    });
    expect(usernameResult.meta.profile).toBe("strict");
    expect(usernameResult.action).toBe("block");

    const commentResult = await moderator.moderate({
      text: "steamy bio text",
      surface: "comment"
    });
    expect(commentResult.meta.profile).toBe("standard");
    expect(commentResult.action).toBe("flag_for_review");
    expect(commentResult.flagged).toBe(true);
  });

  it("allows benign slang when all Jev scores are below review thresholds", async () => {
    const evaluator = createMockEvaluator({
      harassment: 0.08,
      violence_or_threats: 0.04
    });
    const moderator = createModerator({ jevEvaluator: evaluator });

    const res = await moderator.moderate({
      text: "That workout kicked my ass today!",
      surface: "post"
    });

    expect(res.flagged).toBe(false);
    expect(res.action).toBe("allow");
    expect(res.reasons).toEqual([]);
  });

  it("falls back to degraded flag_for_review without caching when Jev throws or times out", async () => {
    const evaluator = createMockEvaluator(new Error("Jev upstream 503"));
    const moderator = createModerator({ jevEvaluator: evaluator });

    const degraded = await moderator.moderate({
      text: "Unseen content needing AI evaluation",
      surface: "comment"
    });

    expect(degraded.flagged).toBe(true);
    expect(degraded.action).toBe("flag_for_review");
    expect(degraded.meta.degraded).toBe(true);
    expect(degraded.meta.tier).toBe("jev");

    // Verify failure was NOT cached
    await moderator.moderate({
      text: "Unseen content needing AI evaluation",
      surface: "comment"
    });
    expect(evaluator.evaluate).toHaveBeenCalledTimes(2);
  });
});
