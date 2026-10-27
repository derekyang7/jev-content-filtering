import { describe, expect, it } from "vitest";
import { normalizeText } from "../../src/core/normalize.js";
import { runPrefilter } from "../../src/core/prefilter.js";

describe("runPrefilter", () => {
  it("immediately allows empty or whitespace-only text", () => {
    const decision = runPrefilter(normalizeText("   \n\t  "));
    expect(decision.decided).toBe(true);
    expect(decision.action).toBe("allow");
    expect(decision.flagged).toBe(false);
    expect(decision.reasons).toEqual([]);
  });

  it("blocks severe hate slurs and obfuscated variants with hate_speech", () => {
    const exact = runPrefilter(normalizeText("you are a faggot"));
    expect(exact.decided).toBe(true);
    expect(exact.action).toBe("block");
    expect(exact.flagged).toBe(true);
    expect(exact.reasons).toContain("hate_speech");
    expect(exact.scores?.hate_speech).toBe(1);

    const leet = runPrefilter(normalizeText("you are a f@gg0t"));
    expect(leet.decided).toBe(true);
    expect(leet.action).toBe("block");
    expect(leet.reasons).toContain("hate_speech");
  });

  it("blocks explicit self-harm encouragement phrases with self_harm", () => {
    const decision = runPrefilter(normalizeText("go kill yourself right now"));
    expect(decision.decided).toBe(true);
    expect(decision.action).toBe("block");
    expect(decision.reasons).toContain("self_harm");
    expect(decision.scores?.self_harm).toBe(1);
  });

  it("does NOT block benign words or Scunthorpe substrings, passing them to Jev", () => {
    const benignSamples = [
      "This workout kicked my ass!",
      "I am taking a classic literature class in Scunthorpe",
      "The assassin creed game is great",
      "Let's analyze the grape harvest and basement layout"
    ];

    for (const sample of benignSamples) {
      const decision = runPrefilter(normalizeText(sample));
      expect(decision.decided).toBe(false);
    }
  });

  it("blocks URL spam floods (>3 URLs by default) with spam_or_scam", () => {
    const spam =
      "Check out https://a.com https://b.com https://c.com and http://d.com now!";
    const decision = runPrefilter(normalizeText(spam));
    expect(decision.decided).toBe(true);
    expect(decision.action).toBe("block");
    expect(decision.reasons).toEqual(["spam_or_scam"]);
    expect(decision.scores?.spam_or_scam).toBe(1);
  });

  it("blocks extreme character repetition (>12 identical consecutive chars) with spam_or_scam", () => {
    const flood = "heyyyyyyyyyyyyyyyyyyyyyyyyy buy crypto";
    const decision = runPrefilter(normalizeText(flood));
    expect(decision.decided).toBe(true);
    expect(decision.action).toBe("block");
    expect(decision.reasons).toEqual(["spam_or_scam"]);
  });
});
