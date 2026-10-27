import type { NormalizedText } from "./types.js";

const ZERO_WIDTH_REGEX = /[\u200B-\u200D\uFEFF\u00AD\u2060]/g;

const LEET_MAP: Record<string, string> = {
  "@": "a",
  "4": "a",
  "$": "s",
  "5": "s",
  "1": "i",
  "!": "i",
  "|": "i",
  "0": "o",
  "3": "e",
  "7": "t",
  "+": "t"
};

function collapseSpacedSingleLetters(input: string): string {
  return input.replace(
    /\b([a-z])(?:\s+([a-z])){2,}\b/g,
    (match) => match.replace(/\s+/g, "")
  );
}

export function normalizeText(raw: string): NormalizedText {
  const withoutZeroWidth = raw.replace(ZERO_WIDTH_REGEX, "");
  const nfkc = withoutZeroWidth.normalize("NFKC");

  const cleanedText = nfkc
    .replace(/[^\S\r\n\t]+/g, " ")
    .trim();

  const canonicalKeyText = cleanedText
    .replace(/\s+/g, " ")
    .toLowerCase();

  const leetReplaced = canonicalKeyText
    .split("")
    .map((ch) => LEET_MAP[ch] ?? ch)
    .join("")
    .replace(/([a-z])\.[a-z](?:\.[a-z])+/g, (m) => m.replace(/\./g, ""))
    .replace(/([a-z])-[a-z](?:-[a-z])+/g, (m) => m.replace(/-/g, ""))
    .replace(/([a-z])_[a-z](?:_[a-z])+/g, (m) => m.replace(/_/g, ""));

  const deobfuscatedText = collapseSpacedSingleLetters(leetReplaced);

  return {
    cleanedText,
    canonicalKeyText,
    deobfuscatedText
  };
}
