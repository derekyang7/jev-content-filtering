# Jev UGC Content Filtering

A stateless, reusable User-Generated Content (UGC) moderation library and Edge HTTP API powered by TypeSafe AI's **Jev** (`system-one`) decision model, built to help mobile apps comply with **Apple App Store Review Guideline 1.2 (Safety — User-Generated Content)**.

---

## Overview & Purpose

Apple's App Store Review Guideline 1.2 requires mobile apps that feature user-generated content (comments, posts, chat messages, usernames, profile bios, or AI prompts) to include a method for filtering objectionable material before or as it is published.

`jev-content-filtering` provides both an importable TypeScript engine (`src/core/`) and a lightweight Hono HTTP service (`src/server/`) that evaluate UGC through a fast, low-cost **3-tier filtering pipeline**:

1. **Tier 1 — Deterministic Pre-Filter (`<1ms`, \$0):** Normalizes Unicode (`NFKC`), strips zero-width evasion characters, deobfuscates common leetspeak/spaced-letter patterns, and immediately blocks severe hate slurs, explicit self-harm phrases, URL spam floods (`>3` URLs), and character repetition floods (`>12` identical consecutive characters) while avoiding Scunthorpe false positives (`"class"`, `"assassin"`, `"workout kicked my ass"`).
2. **Tier 2 — Normalized SHA-256 LRU Cache (`~1ms`, \$0):** Hashes `(profile, surface, canonicalKeyText, canonicalContext)` with SHA-256 and serves repeated phrases or spam strings from an in-memory TTL/LRU cache without storing raw user text or re-calling the AI model.
3. **Tier 3 — Single-Pass Jev Evaluation (`~100–300ms`):** Evaluates novel text in a single parallel request using TypeSafe AI's `jev-latest` model across six isolated `noul` (calibrated `[0.0, 1.0]` probability) propositions mapped to Apple's UGC safety rules:
   - `hate_speech`
   - `harassment`
   - `sexual_content`
   - `violence_or_threats`
   - `self_harm`
   - `spam_or_scam`

---

## Requirements

- **Node.js:** `>= 20.0.0` (uses native `fetch`, `AbortController`, and `node:crypto`)
- **TypeScript:** `>= 5.0`
- **Jev Upstream API Key (`TYPESAFE_API_KEY` or `OPENROUTER_API_KEY`):** Required at runtime for Tier 3 Jev evaluations (all unit and integration tests run offline without a key).

---

## Installation & Configuration

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment variables:**
   Copy `.env.example` to `.env` and set your keys:
   ```bash
   cp .env.example .env
   ```

   | Environment Variable | Default | Description |
   |---|---|---|
   | `TYPESAFE_API_KEY` | *(required if not using OpenRouter)* | Upstream TypeSafe AI API key (`https://api.typesafe.ai/v1/systemone`, model `jev-latest`). |
   | `OPENROUTER_API_KEY` | *(required if not using TypeSafe)* | Upstream OpenRouter API key (`https://openrouter.ai/api/v1/systemone`, model `typesafe/jev-latest`). |
   | `JEV_PROVIDER` | *(auto-detected)* | Optional explicit provider override (`"typesafe"` or `"openrouter"`). |
   | `MODERATION_API_KEYS` | *(empty = open)* | Comma-separated client API keys (`app_name:secret` or `secret`), e.g. `ios_app:app_key_123,android_app:app_key_456`. |
   | `PORT` | `3000` | HTTP server listening port. |
   | `MAX_TEXT_LENGTH` | `2000` | Maximum allowed character length for `text`. |
   | `RATE_LIMIT_MAX` | `60` | Maximum requests allowed per `(apiKey + clientIP)` within the rate limit window. |
   | `RATE_LIMIT_WINDOW_MS` | `60000` | Sliding window duration in milliseconds (default: 60 seconds). |
   | `JEV_TIMEOUT_MS` | `3000` | Timeout in milliseconds for upstream Jev API requests. |

3. **Build and start the server:**
   ```bash
   # Development mode (with hot reload)
   npm run dev

   # Production build & start
   npm run build
   npm start

   # Run offline test suite
   npm test
   ```

---

## Usage

### 1. HTTP API (`POST /v1/moderate`)

#### Request
```bash
curl -X POST http://localhost:3000/v1/moderate \
  -H "Content-Type: application/json" \
  -H "X-API-Key: app_key_123" \
  -d '{
    "text": "Great photo, thanks for sharing!",
    "surface": "comment",
    "context": "Replying to @alex workout post"
  }'
```

- `text` *(required, string)*: The UGC text to evaluate (max `2,000` characters by default).
- `surface` *(optional)*: `"username" | "bio" | "comment" | "post" | "chat" | "ai_prompt"`. Automatically selects the default policy profile when `profile` is omitted:
  - `username`, `bio` → `strict`
  - `comment`, `post`, `ai_prompt` (default) → `standard`
  - `chat` → `lenient`
- `profile` *(optional)*: Explicit threshold profile override (`"strict" | "standard" | "lenient"`).
- `context` *(optional, string)*: Parent comment or conversation context (max `500` characters).

#### Response (`200 OK`)
```json
{
  "flagged": false,
  "action": "allow",
  "reasons": [],
  "scores": {
    "hate_speech": 0,
    "harassment": 0.04,
    "sexual_content": 0,
    "violence_or_threats": 0,
    "self_harm": 0,
    "spam_or_scam": 0
  },
  "meta": {
    "tier": "jev",
    "profile": "standard",
    "surface": "comment",
    "cached": false,
    "degraded": false,
    "latencyMs": 134
  }
}
```

- `action`:
  - `"allow"` (`flagged: false`): Content passed all category thresholds and is safe to publish.
  - `"flag_for_review"` (`flagged: true`): Content exceeded a review threshold (or upstream Jev timed out in degraded mode); hold for review or warn the user.
  - `"block"` (`flagged: true`): Content violated a block threshold (or Tier 1 pre-filter); reject publication immediately.

---

### 2. Calling from an iOS App (Swift `async/await`)

```swift
import Foundation

struct ModerationRequest: Encodable {
    let text: String
    let surface: String
    let context: String?
}

struct ModerationResponse: Decodable {
    let flagged: Bool
    let action: String // "allow" | "flag_for_review" | "block"
    let reasons: [String]
    let scores: [String: Double]
    let meta: Meta

    struct Meta: Decodable {
        let tier: String
        let profile: String
        let surface: String
        let cached: Bool
        let degraded: Bool
        let latencyMs: Int
    }
}

func moderateUGC(text: String, surface: String = "comment") async throws -> ModerationResponse {
    let url = URL(string: "https://your-moderation-api.example.com/v1/moderate")!
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue("app_key_123", forHTTPHeaderField: "X-API-Key")
    request.httpBody = try JSONEncoder().encode(
        ModerationRequest(text: text, surface: surface, context: nil)
    )

    let (data, response) = try await URLSession.shared.data(for: request)
    guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
        throw URLError(.badServerResponse)
    }
    return try JSONDecoder().decode(ModerationResponse.self, from: data)
}
```

---

### 3. Direct TypeScript / Node.js Library Usage

If your mobile app already uses a TypeScript backend, you can import the moderation engine directly without an HTTP hop:

```typescript
import { createModerator, moderateContent } from "jev-content-filtering";

// Quick evaluation using default settings (reads TYPESAFE_API_KEY from env)
const result = await moderateContent({
  text: "This workout kicked my ass!",
  surface: "post"
});

if (result.action === "block") {
  throw new Error(`Content blocked for: ${result.reasons.join(", ")}`);
}

// Or create a customized moderator instance
const moderator = createModerator({
  jevOptions: {
    apiKey: process.env.TYPESAFE_API_KEY,
    timeoutMs: 2500
  },
  cacheOptions: {
    maxEntries: 10_000,
    ttlMs: 3_600_000
  },
  prefilterOptions: {
    maxUrls: 2,
    customBlockedTerms: ["customslur"]
  }
});

const customResult = await moderator.moderate({
  text: "New username",
  surface: "username" // automatically uses the "strict" profile
});
```

---

## Error Handling & Timeouts

The service includes built-in timeout protection, graceful degradation, and HTTP rate-limit signaling (it does not perform automatic upstream retries):

1. **Upstream Jev Timeout (`JEV_TIMEOUT_MS`):**
   - `TypeSafeJevEvaluator` bounds every Jev API request with an `AbortController` timer (default `3,000ms`).
2. **Graceful Degradation on Upstream Failure (`meta.degraded`):**
   - If the Jev API times out, is unreachable, or returns a `5xx` error after Tier 1 pre-filtering has already passed, `moderator.ts` catches the failure, **skips caching**, and returns a safe fallback response:
     - `flagged: true`
     - `action: "flag_for_review"`
     - `reasons: []`
     - `meta.degraded: true`
   - Tier 1 deterministic checks always run before Jev, so explicit slurs, self-harm phrases, and spam floods are still blocked (`action: "block"`) even during an upstream outage.
3. **HTTP Error Status Codes:**
   - `400 Bad Request`: Missing `text`, `text` exceeds `MAX_TEXT_LENGTH`, `context` exceeds `500` characters, or invalid `surface`/`profile` value.
   - `401 Unauthorized`: Missing or invalid `X-API-Key` / `Authorization: Bearer <key>` header when `MODERATION_API_KEYS` is configured.
   - `429 Too Many Requests`: Sliding-window rate limit exceeded. Includes a `Retry-After` response header indicating the number of seconds to wait before retrying.

---

## License

MIT
