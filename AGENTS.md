# AGENTS.md

## Commands
- Install: `npm install`
- Test (offline): `npm test`
- Single test file: `npx vitest run tests/core/moderator.test.ts`
- Build (`dist/`): `npm run build`
- Dev server: `npm run dev`

## Architecture & Module Boundaries
- `src/core/` must remain pure TypeScript/Node with zero Hono or HTTP framework imports.
- `src/server/` wraps `src/core/` in Hono routes (`POST /v1/moderate`, `GET /health`) and middleware.
- All relative imports in `src/` and `tests/` must use `.js` extensions (`"moduleResolution": "NodeNext"`).
- `tsconfig.json` excludes `tests/` from `npm run build`; only `src/**/*` is compiled to `dist/`.
- `@typesafe-ai/sdk` is intentionally omitted from `package.json`; `src/core/jev-evaluator.ts` calls TypeSafe (`https://api.typesafe.ai/v1/systemone`) or OpenRouter (`https://openrouter.ai/api/v1/systemone`) via native `fetch`, or accepts an injected `SystemOneClient` (`options.client`).

## Pipeline Invariants
- Order of execution in `src/core/moderator.ts` is strictly Tier 1 (`prefilter`) -> Tier 2 (`cache`) -> Tier 3 (`jev-evaluator`).
- `ModerationResult.flagged` must be `true` when `action` is `"block"` or `"flag_for_review"`, and `false` when `action` is `"allow"`.
- Surface-to-profile defaults (`src/core/policies.ts`): `username` and `bio` -> `"strict"`; `comment`, `post`, and `ai_prompt` -> `"standard"`; `chat` -> `"lenient"`.
- Tier 1 (`src/core/prefilter.ts`) uses whole-word boundary regexes (`\b...\bs?\b`) against `canonicalKeyText` and `deobfuscatedText`; never use substring checks that trigger Scunthorpe false positives (`"class"`, `"assassin"`, `"workout kicked my ass"`).
- Tier 2 (`src/core/cache.ts`) keys on `SHA-256(JSON.stringify([profile, surface, canonicalKeyText, canonicalContext]))` and stores only `CachedEvaluation` (`flagged`, `action`, `reasons`, `scores`); never store raw user text.
- Tier 3 failures/timeouts (`JEV_TIMEOUT_MS`, default `3000ms`) must return `{ flagged: true, action: "flag_for_review", reasons: [], meta: { tier: "jev", degraded: true } }` and must never be written to the Tier 2 cache.

## Server & Security Rules
- Clients cannot pass custom Jev prompts or questions; `/v1/moderate` only accepts `{ text, surface?, profile?, context? }`.
- Default input limits: `text` <= `2000` chars (`MAX_TEXT_LENGTH`), `context` <= `500` chars.
- `src/server/middleware/auth.ts`: when `MODERATION_API_KEYS` is empty/unset, `/v1/*` routes are open; when set (`name:secret` or `secret`, comma-separated), accepts `X-API-Key` or `Authorization: Bearer <secret>`.
- `GET /health` must remain unauthenticated.

## Testing Rules
- All tests in `tests/` must run 100% offline without `TYPESAFE_API_KEY`.
- Inject a mock `jevEvaluator` into `createModerator({ jevEvaluator })` or `createApp({ moderatorOptions: { jevEvaluator } })` instead of making network calls.
