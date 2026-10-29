import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TypeSafeJevEvaluator } from "../../src/core/jev-evaluator.js";
import { JEV_CATEGORY_PROPOSITIONS } from "../../src/core/policies.js";

function createFetchOkResponse(answers: Record<string, { noul: number }> = {}) {
  return new Response(
    JSON.stringify({
      answers: {
        hate_speech: { noul: 0.01 },
        harassment: { noul: 0.12 },
        sexual_content: { noul: 0.0 },
        violence_or_threats: { noul: 0.02 },
        self_harm: { noul: 0.0 },
        spam_or_scam: { noul: 0.05 },
        ...answers
      }
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" }
    }
  );
}

describe("TypeSafeJevEvaluator", () => {
  const originalEnv = process.env;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.TYPESAFE_API_KEY;
    delete process.env.TYPESAFE_BASE_URL;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_BASE_URL;
    delete process.env.JEV_PROVIDER;
    delete process.env.JEV_MODEL;

    fetchMock = vi.fn(async () => createFetchOkResponse());
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.unstubAllGlobals();
  });

  it("sends noul questions with instructions to TypeSafe /v1/systemone by default", async () => {
    process.env.TYPESAFE_API_KEY = "ts_live_123";
    const evaluator = new TypeSafeJevEvaluator();

    const scores = await evaluator.evaluate({
      surface: "comment",
      contentToEvaluate: "Hello world",
      parentContext: "Parent post"
    });

    expect(scores.harassment).toBe(0.12);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(init.headers).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer ts_live_123"
    });

    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("jev-latest");
    expect(JSON.parse(body.state)).toEqual({
      surface: "comment",
      content_to_evaluate: "Hello world",
      parent_context: "Parent post"
    });
    expect(body.questions.hate_speech).toEqual({
      type: "noul",
      instructions: JEV_CATEGORY_PROPOSITIONS.hate_speech
    });
  });

  it("auto-detects OpenRouter when OPENROUTER_API_KEY is set in env", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-v1-env-key";
    const evaluator = new TypeSafeJevEvaluator();

    await evaluator.evaluate({
      surface: "post",
      contentToEvaluate: "Check this out"
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://openrouter.ai/api/v1/systemone");
    expect(init.headers).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer sk-or-v1-env-key"
    });

    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("typesafe/jev-latest");
  });

  it("auto-detects OpenRouter when options.apiKey has an sk-or- prefix", async () => {
    process.env.TYPESAFE_API_KEY = "ts_live_ignored";
    const evaluator = new TypeSafeJevEvaluator({
      apiKey: "sk-or-v1-direct-key"
    });

    await evaluator.evaluate({
      surface: "chat",
      contentToEvaluate: "Direct key test"
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://openrouter.ai/api/v1/systemone");
    expect(init.headers).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer sk-or-v1-direct-key"
    });

    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("typesafe/jev-latest");
  });

  it("uses explicit provider option or JEV_PROVIDER when both env keys are present", async () => {
    process.env.TYPESAFE_API_KEY = "ts_live_both";
    process.env.OPENROUTER_API_KEY = "sk-or-v1-both";
    process.env.JEV_PROVIDER = "openrouter";

    const envSelectedEvaluator = new TypeSafeJevEvaluator();
    await envSelectedEvaluator.evaluate({
      surface: "comment",
      contentToEvaluate: "Env provider selection"
    });

    const [envUrl, envInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(envUrl).toBe("https://openrouter.ai/api/v1/systemone");
    expect(envInit.headers).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer sk-or-v1-both"
    });

    const optionOverrideEvaluator = new TypeSafeJevEvaluator({
      provider: "typesafe"
    });
    await optionOverrideEvaluator.evaluate({
      surface: "comment",
      contentToEvaluate: "Option provider override"
    });

    const [optUrl, optInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(optUrl).toBe("https://api.typesafe.ai/v1/systemone");
    expect(optInit.headers).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer ts_live_both"
    });
  });

  it("throws a descriptive error when neither TYPESAFE_API_KEY nor OPENROUTER_API_KEY is configured", async () => {
    const evaluator = new TypeSafeJevEvaluator();

    await expect(
      evaluator.evaluate({
        surface: "comment",
        contentToEvaluate: "No key"
      })
    ).rejects.toThrow(
      "Missing TYPESAFE_API_KEY or OPENROUTER_API_KEY for Jev evaluation"
    );
  });

  it("clamps returned noul scores to [0, 1] and rounds to 4 decimals", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-v1-test";
    fetchMock.mockResolvedValueOnce(
      createFetchOkResponse({
        hate_speech: { noul: 1.25 },
        harassment: { noul: -0.2 },
        sexual_content: { noul: 0.123456 }
      })
    );

    const evaluator = new TypeSafeJevEvaluator();
    const scores = await evaluator.evaluate({
      surface: "comment",
      contentToEvaluate: "Clamp test"
    });

    expect(scores.hate_speech).toBe(1);
    expect(scores.harassment).toBe(0);
    expect(scores.sexual_content).toBe(0.1235);
  });
});
