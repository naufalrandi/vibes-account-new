import { afterEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => {
  (globalThis as { __SKIP_DB_SETUP__?: boolean }).__SKIP_DB_SETUP__ = true;
  return { create: vi.fn(), list: vi.fn(), options: [] as unknown[] };
});

// Keep the real error classes (the adapter maps them with instanceof); fake the client.
vi.mock("@anthropic-ai/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@anthropic-ai/sdk")>();
  class FakeAnthropic {
    messages = { create: sdk.create };
    models = { list: sdk.list };
    constructor(opts: unknown) {
      sdk.options.push(opts);
    }
  }
  return { ...actual, default: FakeAnthropic };
});

import { APIConnectionTimeoutError, AuthenticationError, NotFoundError, RateLimitError } from "@anthropic-ai/sdk";
import { anthropicComplete, anthropicListModels } from "./anthropic";
import { openaiComplete, openaiListModels } from "./openaiCompatible";
import { normalizeBaseUrl } from "./shared";
import { AiProviderError } from "../errors";

const KEY = "sk-secret-key-abcd1234";
const cfg = { apiKey: KEY, baseUrl: "https://api.example.test", timeoutMs: 5000 };
const req = { model: "m-1", system: "Be brief", messages: [{ role: "user" as const, content: "Hi" }], maxTokens: 100 };
const apiErrorBody = (message: string) => ({ type: "error", error: { type: "x", message } });

async function providerError(p: Promise<unknown>): Promise<AiProviderError> {
  const err = await p.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(AiProviderError);
  expect((err as AiProviderError).message).not.toContain(KEY);
  return err as AiProviderError;
}

afterEach(() => {
  vi.clearAllMocks();
  sdk.options.length = 0;
  vi.unstubAllGlobals();
});

describe("normalizeBaseUrl", () => {
  it("trims, drops trailing slashes and defaults per provider", () => {
    expect(normalizeBaseUrl("openai", " https://x.test/v1// ")).toBe("https://x.test/v1");
    expect(normalizeBaseUrl("anthropic", "")).toBe("https://api.anthropic.com");
    expect(normalizeBaseUrl("openai", null)).toBe("https://api.openai.com/v1");
  });
});

describe("anthropic adapter", () => {
  it("creates the client from the config and joins text blocks", async () => {
    sdk.create.mockResolvedValue({
      model: "m-1-2026",
      stop_reason: "end_turn",
      content: [{ type: "text", text: "Hello " }, { type: "thinking", thinking: "…" }, { type: "text", text: "there" }],
      usage: { input_tokens: 12, output_tokens: 3 },
    });
    const out = await anthropicComplete(cfg, req);
    expect(out).toEqual({ text: "Hello there", model: "m-1-2026", usage: { inputTokens: 12, outputTokens: 3 } });
    expect(sdk.options[0]).toMatchObject({ apiKey: KEY, baseURL: cfg.baseUrl, timeout: 5000, maxRetries: 1 });
    expect(sdk.create).toHaveBeenCalledWith({ model: "m-1", max_tokens: 100, system: "Be brief", messages: req.messages });
  });

  it("turns a refusal into a provider error", async () => {
    sdk.create.mockResolvedValue({ model: "m", stop_reason: "refusal", content: [], usage: { input_tokens: 1, output_tokens: 0 } });
    expect((await providerError(anthropicComplete(cfg, req))).message).toBe("The model declined this request");
  });

  it("maps typed SDK errors to safe messages", async () => {
    sdk.create.mockRejectedValueOnce(new AuthenticationError(401, apiErrorBody(`bad key ${KEY}`), "401", new Headers()));
    expect((await providerError(anthropicComplete(cfg, req))).message).toBe("Invalid API key: bad key ***");
    sdk.create.mockRejectedValueOnce(new NotFoundError(404, apiErrorBody("model: m-1"), "404", new Headers()));
    expect((await providerError(anthropicComplete(cfg, req))).message).toBe("Model or endpoint not found: model: m-1");
    sdk.create.mockRejectedValueOnce(new RateLimitError(429, undefined, "429", new Headers()));
    expect((await providerError(anthropicComplete(cfg, req))).message).toBe("Rate limited by the provider");
    sdk.create.mockRejectedValueOnce(new APIConnectionTimeoutError());
    expect((await providerError(anthropicComplete(cfg, req))).message).toBe("The provider did not respond within 5s");
  });

  it("lists model ids", async () => {
    sdk.list.mockReturnValue((async function* () {
      yield { id: "claude-a" };
      yield { id: "claude-b" };
    })());
    expect(await anthropicListModels(cfg)).toEqual(["claude-a", "claude-b"]);
  });
});

describe("openai-compatible adapter", () => {
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

  it("posts chat completions with the system message first", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      json(200, { model: "gpt-x", choices: [{ message: { content: "OK" } }], usage: { prompt_tokens: 7, completion_tokens: 1 } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const out = await openaiComplete(cfg, req);
    expect(out).toEqual({ text: "OK", model: "gpt-x", usage: { inputTokens: 7, outputTokens: 1 } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.example.test/chat/completions");
    expect(init.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(init.body)).toEqual({
      model: "m-1",
      max_tokens: 100,
      messages: [{ role: "system", content: "Be brief" }, { role: "user", content: "Hi" }],
    });
  });

  it("retries with max_completion_tokens when the model rejects max_tokens", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(400, { error: { message: "Unsupported parameter: 'max_tokens'. Use 'max_completion_tokens' instead." } }))
      .mockResolvedValueOnce(json(200, { model: "o-x", choices: [{ message: { content: "OK" } }] }));
    vi.stubGlobal("fetch", fetchMock);
    expect((await openaiComplete(cfg, req)).text).toBe("OK");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const second = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(second.max_completion_tokens).toBe(100);
    expect(second.max_tokens).toBeUndefined();
  });

  it("turns a refusal into a provider error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(200, { choices: [{ message: { content: null, refusal: "no" } }] })));
    expect((await providerError(openaiComplete(cfg, req))).message).toBe("The model declined this request");
  });

  it("maps a 401 to a safe message with the truncated, scrubbed provider detail", async () => {
    const long = `Incorrect API key provided: ${KEY} ${"x".repeat(400)}`;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(401, { error: { message: long } })));
    const err = await providerError(openaiComplete(cfg, req));
    expect(err.message.startsWith("Invalid API key: Incorrect API key provided: ***")).toBe(true);
    expect(err.message.length).toBeLessThanOrEqual("Invalid API key: ".length + 300);
  });

  it("aborts after the timeout", async () => {
    vi.stubGlobal("fetch", vi.fn((_url: string, init: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted"))))));
    const err = await providerError(openaiComplete({ ...cfg, timeoutMs: 20 }, req));
    expect(err.message).toBe("The provider did not respond within 0s");
  });

  it("reports an unreachable endpoint", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    expect((await providerError(openaiComplete(cfg, req))).message).toBe("Could not reach the provider — check the base URL");
  });

  it("lists model ids from /models", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, { data: [{ id: "gpt-a" }, { id: "gpt-b" }] }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await openaiListModels(cfg)).toEqual(["gpt-a", "gpt-b"]);
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.test/models");
  });
});
