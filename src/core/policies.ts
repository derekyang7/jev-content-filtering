import {
  MODERATION_CATEGORIES,
  type CategoryScores,
  type ModerationAction,
  type ModerationCategory,
  type ModerationSurface,
  type PolicyProfile,
  type PolicyProfileName
} from "./types.js";

export const JEV_CATEGORY_PROPOSITIONS: Record<ModerationCategory, string> = {
  hate_speech:
    "The content in content_to_evaluate promotes hatred, discrimination, slurs, or demeaning attacks against a group or individual based on race, religion, gender, sexual orientation, disability, or nationality.",
  harassment:
    "The content in content_to_evaluate bullies, insults, stalks, doxxes, or targets a person with abusive or demeaning language, rather than benign slang or general frustration.",
  sexual_content:
    "The content in content_to_evaluate contains explicit sexual descriptions, pornography, sexual solicitation, or non-consensual sexual material.",
  violence_or_threats:
    "The content in content_to_evaluate threatens, encourages, or depicts realistic physical violence, graphic harm, illegal acts, or weapons attacks.",
  self_harm:
    "The content in content_to_evaluate encourages, instructs, or expresses intent for suicide, self-injury, or eating disorders.",
  spam_or_scam:
    "The content in content_to_evaluate is commercial spam, phishing, financial scam solicitation, or deceptive promotional links."
};

export const POLICY_THRESHOLD_PROFILES: Record<PolicyProfileName, PolicyProfile> =
  {
    strict: {
      hate_speech: { review: 0.35, block: 0.6 },
      self_harm: { review: 0.35, block: 0.6 },
      sexual_content: { review: 0.35, block: 0.6 },
      violence_or_threats: { review: 0.4, block: 0.7 },
      harassment: { review: 0.4, block: 0.7 },
      spam_or_scam: { review: 0.4, block: 0.7 }
    },
    standard: {
      hate_speech: { review: 0.45, block: 0.75 },
      self_harm: { review: 0.45, block: 0.75 },
      sexual_content: { review: 0.5, block: 0.75 },
      violence_or_threats: { review: 0.5, block: 0.8 },
      harassment: { review: 0.5, block: 0.85 },
      spam_or_scam: { review: 0.55, block: 0.85 }
    },
    lenient: {
      hate_speech: { review: 0.5, block: 0.75 },
      self_harm: { review: 0.45, block: 0.75 },
      sexual_content: { review: 0.6, block: 0.85 },
      violence_or_threats: { review: 0.55, block: 0.8 },
      harassment: { review: 0.65, block: 0.9 },
      spam_or_scam: { review: 0.65, block: 0.9 }
    }
  };

const SURFACE_DEFAULT_PROFILE: Record<ModerationSurface, PolicyProfileName> = {
  username: "strict",
  bio: "strict",
  comment: "standard",
  post: "standard",
  ai_prompt: "standard",
  chat: "lenient"
};

export function resolveProfileForSurface(
  surface: ModerationSurface,
  explicitProfile?: PolicyProfileName
): PolicyProfileName {
  return explicitProfile ?? SURFACE_DEFAULT_PROFILE[surface];
}

export function evaluateScoresAgainstProfile(
  scores: CategoryScores,
  profileName: PolicyProfileName
): {
  flagged: boolean;
  action: ModerationAction;
  reasons: ModerationCategory[];
} {
  const thresholds = POLICY_THRESHOLD_PROFILES[profileName];
  const reasons: ModerationCategory[] = [];
  let shouldBlock = false;
  let shouldReview = false;

  for (const category of MODERATION_CATEGORIES) {
    const score = scores[category] ?? 0;
    const categoryThreshold = thresholds[category];

    if (score >= categoryThreshold.block) {
      shouldBlock = true;
      reasons.push(category);
    } else if (score >= categoryThreshold.review) {
      shouldReview = true;
      reasons.push(category);
    }
  }

  if (shouldBlock) {
    return { flagged: true, action: "block", reasons };
  }
  if (shouldReview) {
    return { flagged: true, action: "flag_for_review", reasons };
  }
  return { flagged: false, action: "allow", reasons: [] };
}
