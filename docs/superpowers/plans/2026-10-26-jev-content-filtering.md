# Jev UGC Content Filtering System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reusable, stateless TypeScript User-Generated Content (UGC) moderation library and Hono HTTP API powered by TypeSafe AI's Jev decision model for Apple App Store Review Guideline 1.2 compliance.

**Architecture:** A two-layer TypeScript system (`src/core/` and `src/server/`) implementing a 3-tier filtering pipeline: Tier 1 deterministic pre-filtering (`normalize.ts` + `prefilter.ts`), Tier 2 SHA-256 normalized LRU caching (`cache.ts`), and Tier 3 single-pass parallel Jev `noul` evaluation across six Apple Guideline 1.2 safety categories (`policies.ts` + `jev-evaluator.ts` + `moderator.ts`), wrapped in a Hono HTTP service (`server/app.ts`) with per-app API key authentication and sliding-window rate limiting.

**Tech Stack:** TypeScript 5, Node.js (>=20), `@typesafe-ai/sdk`, `hono`, `@hono/node-server`, `vitest`.

**Spec:** `docs/superpowers/specs/2026-10-26-jev-content-filtering-design.md`

## Global Constraints

- Stateless content evaluation only: no database persistence of user content, reports, or block lists.
- Text UGC only: `text` max length defaults to `2,000` characters (`MAX_TEXT_LENGTH`), `context` max length defaults to `500` characters.
- Six exact moderation categories: `"hate_speech" | "harassment" | "sexual_content" | "violence_or_threats" | "self_harm" | "spam_or_scam"`.
- Three policy profiles: `"strict" | "standard" | "lenient"`, derived automatically from `surface` (`username`/`bio` -> `strict`, `comment`/`post`/`ai_prompt` -> `standard`, `chat` -> `lenient`) when `profile` is omitted.
- Three actions: `"allow" | "flag_for_review" | "block"`, where `flagged` is `true` for `"block"` and `"flag_for_review"`, and `false` for `"allow"`.
- All unit and integration tests must run offline via `vitest` without requiring a live `TYPESAFE_API_KEY`.

---

### Task 1: Project Scaffolding, Core Types & Text Normalization

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `src/core/types.ts`
- Create: `src/core/normalize.ts`
- Test: `tests/core/normalize.test.ts`

**Interfaces:**
- Consumes: none (foundational task)
- Produces:
  - `src/core/types.ts`: `ModerationCategory`, `ModerationSurface`, `PolicyProfileName`, `ModerationAction`, `ModerationTier`, `ModerationRequest`, `ModerationResult`, `CategoryThreshold`, `PolicyProfile`, `NormalizedText`, `JevEvaluator`
  - `src/core/normalize.ts`: `normalizeText(raw: string): NormalizedText`

- [ ] **Step 1: Create project configuration files (`package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `.env.example`) and install dependencies**

Create `package.json`:
```json
{
  "name": "jev-content-filtering",
  "version": "1.0.0",
  "description": "Reusable UGC content filtering engine and HTTP API powered by TypeSafe AI Jev for Apple App Store Guideline 1.2 compliance",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "start": "node dist/server/index.js",
    "dev": "tsx watch src/server/index.ts",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@hono/node-server": "^1.13.8",
    "@typesafe-ai/sdk": "^0.1.0",
    "hono": "^4.7.2"
  },
  "devDependencies": {
    "@types/node": "^22.13.4",
    "tsx": "^4.19.3",
    "typescript": "^5.7.3",
    "vitest": "^3.0.6"
  }
}
```

Create `tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "declaration": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

Create `vitest.config.ts`:
```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["tests/**/*.test.ts"]
  }
});
```

Create `.gitignore`:
```text
node_modules/
dist/
.env
*.log
.DS_Store
```

Create `.env.example`:
```text
TYPESAFE_API_KEY=ts_live_your_key_here
MODERATION_API_KEYS=ios_app:app_key_123,android_app:app_key_456
PORT=3000
MAX_TEXT_LENGTH=2000
RATE_LIMIT_MAX=60
RATE_LIMIT_WINDOW_MS=60000
JEV_TIMEOUT_MS=3000
```

Run: `npm install` (Note: if `@typesafe-ai/sdk` is not published on the public npm registry or fails to resolve, install `hono`, `@hono/node-server`, `@types/node`, `tsx`, `typescript`, `vitest` and provide a clean local ambient module / lightweight HTTP client adapter for `@typesafe-ai/sdk`).

- [ ] **Step 2: Write the failing test in `tests/core/normalize.test.ts`**

Create `tests/core/normalize.test.ts`:
```typescript
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/core/normalize.test.ts`
Expected: FAIL with module resolution error for `../../src/core/normalize.js`

- [ ] **Step 4: Implement `src/core/types.ts` and `src/core/normalize.ts`**

Create `src/core/types.ts`:
```typescript
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
```

Create `src/core/normalize.ts`:
```typescript
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
```

- [ ] **Step 5: Run test to verify it passes and commit**

Run: `npx vitest run tests/core/normalize.test.ts`
Expected: PASS (4 passed)

Commit:
```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .gitignore .env.example src/core/types.ts src/core/normalize.ts tests/core/normalize.test.ts
git commit -m "feat(core): add project scaffolding, core types, and text normalization"
```

---

### Task 2: Tier 1 Deterministic Pre-Filter

**Files:**
- Create: `src/core/prefilter.ts`
- Test: `tests/core/prefilter.test.ts`

**Interfaces:**
- Consumes:
  - `src/core/types.ts`: `CategoryScores`, `ModerationAction`, `ModerationCategory`, `NormalizedText`, `MODERATION_CATEGORIES`
- Produces:
  - `src/core/prefilter.ts`:
    - `PrefilterOptions`: `{ maxUrls?: number; maxRepeatedChars?: number; customBlockedTerms?: string[] }`
    - `PrefilterDecision`: `{ decided: boolean; action?: ModerationAction; flagged?: boolean; reasons?: ModerationCategory[]; scores?: CategoryScores }`
    - `createZeroScores(): CategoryScores`
    - `runPrefilter(normalized: NormalizedText, options?: PrefilterOptions): PrefilterDecision`

- [ ] **Step 1: Write the failing test in `tests/core/prefilter.test.ts`**

Create `tests/core/prefilter.test.ts`:
```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/prefilter.test.ts`
Expected: FAIL with module resolution error for `../../src/core/prefilter.js`

- [ ] **Step 3: Implement `src/core/prefilter.ts`**

Create `src/core/prefilter.ts`:
```typescript
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
```

- [ ] **Step 4: Run test to verify it passes and commit**

Run: `npx vitest run tests/core/prefilter.test.ts`
Expected: PASS (6 passed)

Commit:
```bash
git add src/core/prefilter.ts tests/core/prefilter.test.ts
git commit -m "feat(core): add Tier 1 deterministic prefilter for slurs, self-harm, and spam"
```

---

### Task 3: Tier 2 Normalized LRU Hash Cache

**Files:**
- Create: `src/core/cache.ts`
- Test: `tests/core/cache.test.ts`

**Interfaces:**
- Consumes:
  - `src/core/types.ts`: `ModerationResult`, `ModerationSurface`, `PolicyProfileName`
- Produces:
  - `src/core/cache.ts`:
    - `CachedEvaluation`: `Pick<ModerationResult, "flagged" | "action" | "reasons" | "scores">`
    - `CacheStore`: `{ get(key: string): CachedEvaluation | undefined; set(key: string, value: CachedEvaluation): void; clear(): void }`
    - `LruCacheOptions`: `{ maxEntries?: number; ttlMs?: number }`
    - `buildCacheKey(params: { profile: PolicyProfileName; surface: ModerationSurface; canonicalKeyText: string; canonicalContext?: string }): string`
    - `InMemoryLruCache`: class implementing `CacheStore`

- [ ] **Step 1: Write the failing test in `tests/core/cache.test.ts`**

Create `tests/core/cache.test.ts`:
```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/cache.test.ts`
Expected: FAIL with module resolution error for `../../src/core/cache.js`

- [ ] **Step 3: Implement `src/core/cache.ts`**

Create `src/core/cache.ts`:
```typescript
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
```

- [ ] **Step 4: Run test to verify it passes and commit**

Run: `npx vitest run tests/core/cache.test.ts`
Expected: PASS (3 passed)

Commit:
```bash
git add src/core/cache.ts tests/core/cache.test.ts
git commit -m "feat(core): add Tier 2 SHA-256 normalized LRU cache"
```

---

### Task 4: Apple Guideline 1.2 Policies, Jev Evaluator & Moderator Pipeline

**Files:**
- Create: `src/core/policies.ts`
- Create: `src/core/jev-evaluator.ts`
- Create: `src/core/moderator.ts`
- Create: `src/index.ts`
- Test: `tests/core/moderator.test.ts`

**Interfaces:**
- Consumes:
  - `src/core/types.ts`: all core types
  - `src/core/normalize.ts`: `normalizeText`
  - `src/core/prefilter.ts`: `runPrefilter`, `createZeroScores`, `PrefilterOptions`
  - `src/core/cache.ts`: `InMemoryLruCache`, `buildCacheKey`, `CacheStore`
- Produces:
  - `src/core/policies.ts`: `JEV_CATEGORY_PROPOSITIONS`, `POLICY_THRESHOLD_PROFILES`, `resolveProfileForSurface(surface: ModerationSurface, explicitProfile?: PolicyProfileName): PolicyProfileName`, `evaluateScoresAgainstProfile(scores: CategoryScores, profileName: PolicyProfileName): { flagged: boolean; action: ModerationAction; reasons: ModerationCategory[] }`
  - `src/core/jev-evaluator.ts`: `TypeSafeJevEvaluator`, `CreateJevEvaluatorOptions`
  - `src/core/moderator.ts`: `ModeratorOptions`, `Moderator`, `createModerator(options?: ModeratorOptions): Moderator`, `moderateContent(request: ModerationRequest, options?: ModeratorOptions): Promise<ModerationResult>`
  - `src/index.ts`: re-exports core public symbols

- [ ] **Step 1: Write the failing test in `tests/core/moderator.test.ts`**

Create `tests/core/moderator.test.ts`:
```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/moderator.test.ts`
Expected: FAIL with module resolution error for `../../src/core/moderator.js`

- [ ] **Step 3: Implement `src/core/policies.ts`, `src/core/jev-evaluator.ts`, `src/core/moderator.ts`, and `src/index.ts`**

Create `src/core/policies.ts`:
```typescript
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
```

Create `src/core/jev-evaluator.ts`:
```typescript
import { JEV_CATEGORY_PROPOSITIONS } from "./policies.js";
import {
  MODERATION_CATEGORIES,
  type CategoryScores,
  type JevEvaluationInput,
  type JevEvaluator,
  type ModerationCategory
} from "./types.js";

export interface SystemOneNoulAnswer {
  noul: number;
}

export interface SystemOneResponse {
  answers: Record<string, SystemOneNoulAnswer>;
}

export interface SystemOneClient {
  systemOne(params: {
    model: string;
    state: string;
    questions: Record<string, unknown>;
  }): Promise<SystemOneResponse>;
}

export interface CreateJevEvaluatorOptions {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  client?: SystemOneClient;
}

function createNoulQuestion(proposition: string): {
  type: "noul";
  question: string;
} {
  return {
    type: "noul",
    question: proposition
  };
}

export class TypeSafeJevEvaluator implements JevEvaluator {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly client?: SystemOneClient;

  constructor(options: CreateJevEvaluatorOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.TYPESAFE_API_KEY ?? "";
    this.baseUrl =
      options.baseUrl ??
      process.env.TYPESAFE_BASE_URL ??
      "https://api.typesafe.ai/v1/system-one";
    this.model = options.model ?? "jev-latest";
    this.timeoutMs =
      options.timeoutMs ?? Number(process.env.JEV_TIMEOUT_MS ?? 3_000);
    this.client = options.client;
  }

  async evaluate(input: JevEvaluationInput): Promise<CategoryScores> {
    const statePayload: Record<string, string> = {
      surface: input.surface,
      content_to_evaluate: input.contentToEvaluate
    };
    if (input.parentContext) {
      statePayload.parent_context = input.parentContext;
    }

    const state = JSON.stringify(statePayload);
    const questions: Record<
      ModerationCategory,
      { type: "noul"; question: string }
    > = {} as Record<ModerationCategory, { type: "noul"; question: string }>;

    for (const category of MODERATION_CATEGORIES) {
      questions[category] = createNoulQuestion(
        JEV_CATEGORY_PROPOSITIONS[category]
      );
    }

    const response = await this.executeWithTimeout(state, questions);
    const scores = {} as CategoryScores;

    for (const category of MODERATION_CATEGORIES) {
      const rawScore = response.answers?.[category]?.noul ?? 0;
      scores[category] = Math.max(0, Math.min(1, Number(rawScore.toFixed(4))));
    }

    return scores;
  }

  private async executeWithTimeout(
    state: string,
    questions: Record<string, { type: "noul"; question: string }>
  ): Promise<SystemOneResponse> {
    if (this.client) {
      return await Promise.race([
        this.client.systemOne({
          model: this.model,
          state,
          questions
        }),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Jev evaluation timed out after ${this.timeoutMs}ms`)),
            this.timeoutMs
          )
        )
      ]);
    }

    if (!this.apiKey) {
      throw new Error("Missing TYPESAFE_API_KEY for Jev evaluation");
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(this.baseUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: this.model,
          state,
          questions
        }),
        signal: controller.signal
      });

      if (!res.ok) {
        throw new Error(`Jev API HTTP ${res.status}`);
      }

      return (await res.json()) as SystemOneResponse;
    } finally {
      clearTimeout(timer);
    }
  }
}
```

Create `src/core/moderator.ts`:
```typescript
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
```

Create `src/index.ts`:
```typescript
export * from "./core/types.js";
export * from "./core/normalize.js";
export * from "./core/prefilter.js";
export * from "./core/cache.js";
export * from "./core/policies.js";
export * from "./core/jev-evaluator.js";
export * from "./core/moderator.js";
```

- [ ] **Step 4: Run tests to verify they pass and commit**

Run: `npx vitest run tests/core/moderator.test.ts`
Expected: PASS (5 passed)

Commit:
```bash
git add src/core/policies.ts src/core/jev-evaluator.ts src/core/moderator.ts src/index.ts tests/core/moderator.test.ts
git commit -m "feat(core): add Apple Guideline 1.2 policies, Jev evaluator, and 3-tier moderator"
```

---

### Task 5: Hono Edge HTTP API, Auth & Rate Limiting Middleware

**Files:**
- Create: `src/server/middleware/auth.ts`
- Create: `src/server/middleware/rate-limit.ts`
- Create: `src/server/app.ts`
- Create: `src/server/index.ts`
- Test: `tests/server/app.test.ts`

**Interfaces:**
- Consumes:
  - `src/core/types.ts`: `MODERATION_SURFACES`, `POLICY_PROFILES`, `ModerationRequest`, `ModerationSurface`, `PolicyProfileName`
  - `src/core/moderator.ts`: `createModerator`, `Moderator`, `ModeratorOptions`
- Produces:
  - `src/server/middleware/auth.ts`: `createAuthMiddleware(rawApiKeys?: string)`
  - `src/server/middleware/rate-limit.ts`: `createRateLimitMiddleware(options?: { maxRequests?: number; windowMs?: number })`
  - `src/server/app.ts`: `CreateAppOptions`, `createApp(options?: CreateAppOptions)`
  - `src/server/index.ts`: Node HTTP server entrypoint

- [ ] **Step 1: Write the failing test in `tests/server/app.test.ts`**

Create `tests/server/app.test.ts`:
```typescript
import { describe, expect, it, vi } from "vitest";
import { createZeroScores } from "../../src/core/prefilter.js";
import { createApp } from "../../src/server/app.js";

function createTestApp(options: {
  apiKeys?: string;
  maxRequests?: number;
  maxTextLength?: number;
} = {}) {
  const mockEvaluator = {
    evaluate: vi.fn(async () => ({
      ...createZeroScores(),
      harassment: 0.1
    }))
  };

  const app = createApp({
    apiKeys: options.apiKeys ?? "ios_app:secret_123",
    maxTextLength: options.maxTextLength ?? 2_000,
    rateLimit: {
      maxRequests: options.maxRequests ?? 60,
      windowMs: 60_000
    },
    moderatorOptions: {
      jevEvaluator: mockEvaluator
    }
  });

  return { app, mockEvaluator };
}

describe("Hono moderation server", () => {
  it("GET /health returns 200 OK without requiring auth", async () => {
    const { app } = createTestApp();
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("POST /v1/moderate rejects missing or invalid API keys with 401", async () => {
    const { app } = createTestApp({ apiKeys: "ios_app:secret_123" });

    const missingKeyRes = await app.request("/v1/moderate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "hello" })
    });
    expect(missingKeyRes.status).toBe(401);

    const wrongKeyRes = await app.request("/v1/moderate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": "wrong_key"
      },
      body: JSON.stringify({ text: "hello" })
    });
    expect(wrongKeyRes.status).toBe(401);
  });

  it("POST /v1/moderate validates request payload and returns 400 on invalid inputs", async () => {
    const { app } = createTestApp({
      apiKeys: "ios_app:secret_123",
      maxTextLength: 20
    });

    const tooLongRes = await app.request("/v1/moderate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": "secret_123"
      },
      body: JSON.stringify({ text: "this string is longer than twenty chars" })
    });
    expect(tooLongRes.status).toBe(400);

    const badSurfaceRes = await app.request("/v1/moderate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer secret_123"
      },
      body: JSON.stringify({ text: "hello", surface: "invalid_surface" })
    });
    expect(badSurfaceRes.status).toBe(400);
  });

  it("POST /v1/moderate returns 200 OK with ModerationResult for valid requests", async () => {
    const { app } = createTestApp({ apiKeys: "ios_app:secret_123" });

    const res = await app.request("/v1/moderate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": "secret_123"
      },
      body: JSON.stringify({
        text: "Great photo, thanks for sharing!",
        surface: "comment"
      })
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.flagged).toBe(false);
    expect(body.action).toBe("allow");
    expect(body.meta.surface).toBe("comment");
    expect(body.meta.profile).toBe("standard");
  });

  it("POST /v1/moderate enforces sliding-window rate limits with 429 Too Many Requests", async () => {
    const { app } = createTestApp({
      apiKeys: "ios_app:secret_123",
      maxRequests: 2
    });

    for (let i = 0; i < 2; i++) {
      const okRes = await app.request("/v1/moderate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": "secret_123"
        },
        body: JSON.stringify({ text: `message ${i}` })
      });
      expect(okRes.status).toBe(200);
    }

    const limitedRes = await app.request("/v1/moderate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": "secret_123"
      },
      body: JSON.stringify({ text: "message 3" })
    });
    expect(limitedRes.status).toBe(429);
    expect(limitedRes.headers.get("Retry-After")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/app.test.ts`
Expected: FAIL with module resolution error for `../../src/server/app.js`

- [ ] **Step 3: Implement `src/server/middleware/auth.ts`, `src/server/middleware/rate-limit.ts`, `src/server/app.ts`, and `src/server/index.ts`**

Create `src/server/middleware/auth.ts`:
```typescript
import type { MiddlewareHandler } from "hono";

export function parseAllowedApiKeys(raw?: string): Set<string> {
  if (!raw || raw.trim().length === 0) {
    return new Set();
  }

  const keys = new Set<string>();
  for (const entry of raw.split(",")) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const colonIndex = trimmed.indexOf(":");
    const secret =
      colonIndex >= 0 ? trimmed.slice(colonIndex + 1).trim() : trimmed;
    if (secret) {
      keys.add(secret);
    }
  }
  return keys;
}

export function createAuthMiddleware(rawApiKeys?: string): MiddlewareHandler {
  const allowedKeys = parseAllowedApiKeys(
    rawApiKeys ?? process.env.MODERATION_API_KEYS
  );

  return async (c, next) => {
    if (allowedKeys.size === 0) {
      await next();
      return;
    }

    const headerKey = c.req.header("X-API-Key")?.trim();
    const authHeader = c.req.header("Authorization")?.trim();
    const bearerKey = authHeader?.toLowerCase().startsWith("bearer ")
      ? authHeader.slice(7).trim()
      : undefined;

    const providedKey = headerKey || bearerKey;
    if (!providedKey || !allowedKeys.has(providedKey)) {
      return c.json(
        { error: "Unauthorized: missing or invalid API key" },
        401
      );
    }

    await next();
  };
}
```

Create `src/server/middleware/rate-limit.ts`:
```typescript
import type { MiddlewareHandler } from "hono";

export interface RateLimitOptions {
  maxRequests?: number;
  windowMs?: number;
}

export function createRateLimitMiddleware(
  options: RateLimitOptions = {}
): MiddlewareHandler {
  const maxRequests =
    options.maxRequests ?? Number(process.env.RATE_LIMIT_MAX ?? 60);
  const windowMs =
    options.windowMs ?? Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000);
  const buckets = new Map<string, number[]>();

  return async (c, next) => {
    const now = Date.now();
    const apiKey =
      c.req.header("X-API-Key") ?? c.req.header("Authorization") ?? "anon";
    const clientIp =
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
    const bucketKey = `${apiKey}:${clientIp}`;

    const timestamps = (buckets.get(bucketKey) ?? []).filter(
      (ts) => now - ts < windowMs
    );

    if (timestamps.length >= maxRequests) {
      const oldest = timestamps[0] ?? now;
      const retryAfterSec = Math.max(
        1,
        Math.ceil((windowMs - (now - oldest)) / 1_000)
      );
      c.header("Retry-After", String(retryAfterSec));
      return c.json({ error: "Too Many Requests: rate limit exceeded" }, 429);
    }

    timestamps.push(now);
    buckets.set(bucketKey, timestamps);

    await next();
  };
}
```

Create `src/server/app.ts`:
```typescript
import { Hono } from "hono";
import {
  createModerator,
  type Moderator,
  type ModeratorOptions
} from "../core/moderator.js";
import {
  MODERATION_SURFACES,
  POLICY_PROFILES,
  type ModerationSurface,
  type PolicyProfileName
} from "../core/types.js";
import { createAuthMiddleware } from "./middleware/auth.js";
import {
  createRateLimitMiddleware,
  type RateLimitOptions
} from "./middleware/rate-limit.js";

export interface CreateAppOptions {
  apiKeys?: string;
  maxTextLength?: number;
  maxContextLength?: number;
  rateLimit?: RateLimitOptions;
  moderator?: Moderator;
  moderatorOptions?: ModeratorOptions;
}

const VALID_SURFACES = new Set<string>(MODERATION_SURFACES);
const VALID_PROFILES = new Set<string>(POLICY_PROFILES);

export function createApp(options: CreateAppOptions = {}): Hono {
  const app = new Hono();
  const maxTextLength =
    options.maxTextLength ?? Number(process.env.MAX_TEXT_LENGTH ?? 2_000);
  const maxContextLength = options.maxContextLength ?? 500;
  const moderator =
    options.moderator ?? createModerator(options.moderatorOptions);

  app.get("/health", (c) => c.json({ status: "ok" }));

  app.use("/v1/*", createAuthMiddleware(options.apiKeys));
  app.use("/v1/*", createRateLimitMiddleware(options.rateLimit));

  app.post("/v1/moderate", async (c) => {
    let body: Record<string, unknown>;
    try {
      body = (await c.req.json()) as Record<string, unknown>;
    } catch {
      return c.json({ error: "Invalid JSON request body" }, 400);
    }

    if (typeof body.text !== "string") {
      return c.json({ error: "Field 'text' is required and must be a string" }, 400);
    }

    if (body.text.length > maxTextLength) {
      return c.json(
        {
          error: `Field 'text' exceeds maximum length of ${maxTextLength} characters`
        },
        400
      );
    }

    if (body.context !== undefined) {
      if (typeof body.context !== "string") {
        return c.json({ error: "Field 'context' must be a string" }, 400);
      }
      if (body.context.length > maxContextLength) {
        return c.json(
          {
            error: `Field 'context' exceeds maximum length of ${maxContextLength} characters`
          },
          400
        );
      }
    }

    if (
      body.surface !== undefined &&
      (typeof body.surface !== "string" || !VALID_SURFACES.has(body.surface))
    ) {
      return c.json(
        {
          error: `Field 'surface' must be one of: ${MODERATION_SURFACES.join(", ")}`
        },
        400
      );
    }

    if (
      body.profile !== undefined &&
      (typeof body.profile !== "string" || !VALID_PROFILES.has(body.profile))
    ) {
      return c.json(
        {
          error: `Field 'profile' must be one of: ${POLICY_PROFILES.join(", ")}`
        },
        400
      );
    }

    const result = await moderator.moderate({
      text: body.text,
      surface: body.surface as ModerationSurface | undefined,
      profile: body.profile as PolicyProfileName | undefined,
      context: body.context as string | undefined
    });

    return c.json(result, 200);
  });

  return app;
}
```

Create `src/server/index.ts`:
```typescript
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";

const port = Number(process.env.PORT ?? 3000);
const app = createApp();

serve(
  {
    fetch: app.fetch,
    port
  },
  (info) => {
    console.log(`Jev Content Filtering API listening on http://localhost:${info.port}`);
  }
);

export default app;
```

- [ ] **Step 4: Run the full test suite and TypeScript build to verify everything passes**

Run: `npx vitest run && npm run build`
Expected: PASS (all 5 test suites pass, `tsc` exits with code 0)

- [ ] **Step 5: Commit**

```bash
git add src/server/middleware/auth.ts src/server/middleware/rate-limit.ts src/server/app.ts src/server/index.ts tests/server/app.test.ts
git commit -m "feat(server): add Hono moderation HTTP API with auth and rate limiting"
```
