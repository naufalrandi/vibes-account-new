import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const ai = vi.hoisted(() => {
  (globalThis as { __SKIP_DB_SETUP__?: boolean }).__SKIP_DB_SETUP__ = true;
  return { complete: vi.fn() };
});
vi.mock("./index", () => ({ aiComplete: ai.complete }));

import { aiCompleteJson, extractJson } from "./json";
import { AiProviderError } from "../errors";

const reply = (text: string, inputTokens = 10, outputTokens = 5) => ({
  text, model: "m-1", provider: "anthropic", usage: { inputTokens, outputTokens }, latencyMs: 100,
});
const schema = z.object({ title: z.string(), score: z.number().int() });
const req = { system: "Rate it.", messages: [{ role: "user" as const, content: "The thing" }] };

describe("extractJson", () => {
  it("strips fences and leading prose, takes the first balanced block", () => {
    expect(extractJson('Sure! Here it is:\n```json\n{"a": "x}y", "b": [1, {"c": 2}]}\n```\nDone.')).toBe('{"a": "x}y", "b": [1, {"c": 2}]}');
    expect(extractJson('Result: [1, 2] and {"x": 1}')).toBe("[1, 2]");
    expect(extractJson('{"a": "quote \\" }"} trailing')).toBe('{"a": "quote \\" }"}');
    expect(extractJson("no json here")).toBeNull();
    expect(extractJson('{"unclosed": 1')).toBeNull();
  });
});

describe("aiCompleteJson", () => {
  beforeEach(() => { ai.complete.mockReset(); });

  it("appends the JSON Schema to the system prompt and returns the parsed value", async () => {
    ai.complete.mockResolvedValueOnce(reply('Here you go: {"title": "T", "score": 3}'));
    const out = await aiCompleteJson(schema, { ...req, maxTokens: 500 });
    expect(out).toEqual({ data: { title: "T", score: 3 }, text: 'Here you go: {"title": "T", "score": 3}', model: "m-1", provider: "anthropic", usage: { inputTokens: 10, outputTokens: 5 }, latencyMs: 100 });
    const call = ai.complete.mock.calls[0][0];
    expect(call.system).toMatch(/^Rate it\.\n\nReply with ONLY a single JSON value/);
    expect(call.system).toContain('"score":{"type":"integer"');
    expect(call.messages).toEqual(req.messages);
    expect(call.maxTokens).toBe(500);
  });

  it("retries once with the validation error and sums usage", async () => {
    ai.complete
      .mockResolvedValueOnce(reply('{"title": "T", "score": "high"}', 10, 5))
      .mockResolvedValueOnce(reply('```json\n{"title": "T", "score": 4}\n```', 20, 7));
    const out = await aiCompleteJson(schema, req);
    expect(out.data).toEqual({ title: "T", score: 4 });
    expect(out.usage).toEqual({ inputTokens: 30, outputTokens: 12 });
    expect(out.latencyMs).toBe(200);
    const retry = ai.complete.mock.calls[1][0].messages;
    expect(retry).toHaveLength(3);
    expect(retry[1]).toEqual({ role: "assistant", content: '{"title": "T", "score": "high"}' });
    expect(retry[2].content).toMatch(/Your reply was invalid:[\s\S]*score/);
  });

  it("throws AiProviderError after the second invalid reply", async () => {
    ai.complete.mockResolvedValueOnce(reply("I cannot do that")).mockResolvedValueOnce(reply("{not json}"));
    await expect(aiCompleteJson(schema, req)).rejects.toEqual(new AiProviderError("The AI returned an invalid response"));
    expect(ai.complete).toHaveBeenCalledTimes(2);
  });

  it("passes provider errors straight through", async () => {
    ai.complete.mockRejectedValueOnce(new AiProviderError("Rate limited by the provider"));
    await expect(aiCompleteJson(schema, req)).rejects.toThrow("Rate limited by the provider");
  });
});
