import { describe, expect, it } from "vitest";
import { normalizeText } from "../../src/core/normalize.js";

describe("normalizeText", () => {
  it("trims whitespace and strips zero-width evasion characters", () => {
    const raw = "  f\u200Bu\u200Cc\u200Dk\uFEFF  ";
    const result = normalizeText(raw);
    expect(result.cleanedText).toBe("fuck");
    expect(result.canonicalKeyText).toBe("fuck");
  });

  it("collapses multiple whitespace characters and lowercases canonicalKeyText", () => {
    const raw = "Hello   WORLD\n\tHow   are   you?";
    const result = normalizeText(raw);
    expect(result.cleanedText).toBe("Hello WORLD\n\tHow are you?");
    expect(result.canonicalKeyText).toBe("hello world how are you?");
  });

  it("normalizes unicode NFKC compatibility characters", () => {
    const raw = "ｆｕｃｋ";
    const result = normalizeText(raw);
    expect(result.cleanedText).toBe("fuck");
    expect(result.canonicalKeyText).toBe("fuck");
  });

  it("deobfuscates leetspeak and spaced-out characters for prefilter matching", () => {
    const leet = normalizeText("b!+ch @$$h0le $h1t");
    expect(leet.deobfuscatedText).toBe("bitch asshole shit");

    const spaced = normalizeText("f u c k you");
    expect(spaced.deobfuscatedText).toContain("fuck");
  });
});
