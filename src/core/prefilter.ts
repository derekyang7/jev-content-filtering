import {
  MODERATION_CATEGORIES,
  type CategoryScores,
  type ModerationAction,
  type ModerationCategory,
  type NormalizedText
} from "./types.js";

export interface PrefilterOptions {
  maxUrls?: number;
  maxRepeatedChars?: number;
  customBlockedTerms?: string[];
}

export interface PrefilterDecision {
  decided: boolean;
  action?: ModerationAction;
  flagged?: boolean;
  reasons?: ModerationCategory[];
  scores?: CategoryScores;
}

const SEVERE_HATE_SLURS = [
  "nigger",
  "nigga",
  "faggot",
  "kike",
  "chink",
  "spic",
  "wetback",
  "tranny",
  "retard"
];

const SEVERE_SELF_HARM_PHRASES = [
  "kill yourself",
  "kys",
  "commit suicide"
];

const URL_REGEX = /https?:\/\/[^\s]+/gi;

export function createZeroScores(): CategoryScores {
  const scores = {} as CategoryScores;
  for (const category of MODERATION_CATEGORIES) {
    scores[category] = 0;
  }
  return scores;
}

function escapeRegex(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsWholeTerm(text: string, terms: string[]): boolean {
  for (const term of terms) {
    const pattern = new RegExp(`\\b${escapeRegex(term)}s?\\b`, "i");
    if (pattern.test(text)) {
      return true;
    }
  }
  return false;
}

export function runPrefilter(
  normalized: NormalizedText,
  options: PrefilterOptions = {}
): PrefilterDecision {
  const maxUrls = options.maxUrls ?? 3;
  const maxRepeatedChars = options.maxRepeatedChars ?? 12;

  if (normalized.cleanedText.length === 0) {
    return {
      decided: true,
      action: "allow",
      flagged: false,
      reasons: [],
      scores: createZeroScores()
    };
  }

  const hateTerms = [
    ...SEVERE_HATE_SLURS,
    ...(options.customBlockedTerms ?? [])
  ];

  if (
    containsWholeTerm(normalized.canonicalKeyText, hateTerms) ||
    containsWholeTerm(normalized.deobfuscatedText, hateTerms)
  ) {
    const scores = createZeroScores();
    scores.hate_speech = 1;
    return {
      decided: true,
      action: "block",
      flagged: true,
      reasons: ["hate_speech"],
      scores
    };
  }

  if (
    containsWholeTerm(normalized.canonicalKeyText, SEVERE_SELF_HARM_PHRASES) ||
    containsWholeTerm(normalized.deobfuscatedText, SEVERE_SELF_HARM_PHRASES)
  ) {
    const scores = createZeroScores();
    scores.self_harm = 1;
    return {
      decided: true,
      action: "block",
      flagged: true,
      reasons: ["self_harm"],
      scores
    };
  }

  const urls = normalized.cleanedText.match(URL_REGEX) ?? [];
  const repeatRegex = new RegExp(`(.)\\1{${maxRepeatedChars},}`, "u");

  if (urls.length > maxUrls || repeatRegex.test(normalized.cleanedText)) {
    const scores = createZeroScores();
    scores.spam_or_scam = 1;
    return {
      decided: true,
      action: "block",
      flagged: true,
      reasons: ["spam_or_scam"],
      scores
    };
  }

  return { decided: false };
}
