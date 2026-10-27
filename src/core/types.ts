export const MODERATION_CATEGORIES = [
  "hate_speech",
  "harassment",
  "sexual_content",
  "violence_or_threats",
  "self_harm",
  "spam_or_scam"
] as const;

export type ModerationCategory = (typeof MODERATION_CATEGORIES)[number];

export const MODERATION_SURFACES = [
  "username",
  "bio",
  "comment",
  "post",
  "chat",
  "ai_prompt"
] as const;

export type ModerationSurface = (typeof MODERATION_SURFACES)[number];

export const POLICY_PROFILES = ["strict", "standard", "lenient"] as const;

export type PolicyProfileName = (typeof POLICY_PROFILES)[number];

export type ModerationAction = "allow" | "flag_for_review" | "block";

export type ModerationTier = "prefilter" | "cache" | "jev";

export interface ModerationRequest {
  text: string;
  surface?: ModerationSurface;
  profile?: PolicyProfileName;
  context?: string;
}

export type CategoryScores = Record<ModerationCategory, number>;

export interface ModerationMeta {
  tier: ModerationTier;
  profile: PolicyProfileName;
  surface: ModerationSurface;
  cached: boolean;
  degraded: boolean;
  latencyMs: number;
}

export interface ModerationResult {
  flagged: boolean;
  action: ModerationAction;
  reasons: ModerationCategory[];
  scores: CategoryScores;
  meta: ModerationMeta;
}

export interface CategoryThreshold {
  review: number;
  block: number;
}

export type PolicyProfile = Record<ModerationCategory, CategoryThreshold>;

export interface NormalizedText {
  cleanedText: string;
  canonicalKeyText: string;
  deobfuscatedText: string;
}

export interface JevEvaluationInput {
  surface: ModerationSurface;
  contentToEvaluate: string;
  parentContext?: string;
}

export interface JevEvaluator {
  evaluate(input: JevEvaluationInput): Promise<CategoryScores>;
}
