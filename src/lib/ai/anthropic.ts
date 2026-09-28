import Anthropic, { APIConnectionError, APIConnectionTimeoutError, APIError } from "@anthropic-ai/sdk";
import { AiProviderError } from "../errors";
import {
  CONNECTION_MESSAGE, MODELS_CAP, REFUSAL_MESSAGE, safeDetail, statusMessage, timeoutMessage,
  type CompletionRequest, type CompletionResult, type ProviderConfig,
} from "./shared";

/** Anthropic Messages API through the official SDK. */
function client(cfg: ProviderConfig): Anthropic {
  // authToken: null so an ANTHROPIC_AUTH_TOKEN in the server env never rides along.
  return new Anthropic({ apiKey: cfg.apiKey, authToken: null, baseURL: cfg.baseUrl, timeout: cfg.timeoutMs, maxRetries: 1 });
}

/** Map an SDK failure to an AiProviderError with a message safe to show (checked most specific first). */
function toProviderError(err: unknown, cfg: ProviderConfig): unknown {
  if (err instanceof APIConnectionTimeoutError) return new AiProviderError(timeoutMessage(cfg.timeoutMs));
  if (err instanceof APIConnectionError) return new AiProviderError(CONNECTION_MESSAGE);
  if (err instanceof APIError && typeof err.status === "number") {
    const body = err.error as { error?: { message?: unknown } } | undefined;
    return new AiProviderError(statusMessage(err.status, safeDetail(body?.error?.message, cfg.apiKey)));
  }
  return err;
}

export async function anthropicComplete(cfg: ProviderConfig, req: CompletionRequest): Promise<CompletionResult> {
  let response: Anthropic.Message;
  try {
    response = await client(cfg).messages.create({
      model: req.model,
      max_tokens: req.maxTokens,
      ...(req.system ? { system: req.system } : {}),
      messages: req.messages,
    });
  } catch (err) {
    throw toProviderError(err, cfg);
  }
  if (response.stop_reason === "refusal") throw new AiProviderError(REFUSAL_MESSAGE);
  const text = response.content.map((block) => (block.type === "text" ? block.text : "")).join("");
  return {
    text,
    model: response.model,
    usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
  };
}

export async function anthropicListModels(cfg: ProviderConfig): Promise<string[]> {
  const ids: string[] = [];
  try {
    for await (const model of client(cfg).models.list({ limit: 100 })) {
      ids.push(model.id);
      if (ids.length >= MODELS_CAP) break;
    }
  } catch (err) {
    throw toProviderError(err, cfg);
  }
  return ids;
}
