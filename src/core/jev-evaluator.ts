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
