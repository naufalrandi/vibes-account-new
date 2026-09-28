import { AiProviderError } from "../errors";
import {
  CONNECTION_MESSAGE, MODELS_CAP, REFUSAL_MESSAGE, safeDetail, statusMessage, timeoutMessage,
  type CompletionRequest, type CompletionResult, type ProviderConfig,
} from "./shared";

/**
 * OpenAI Chat Completions over plain fetch, so any OpenAI-compatible server
 * (OpenAI, Azure-style gateways, OpenRouter, vLLM, Ollama, …) works by base URL.
 */
async function call(cfg: ProviderConfig, path: string, init: { method: "GET" | "POST"; body?: unknown }): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  let status: number;
  let raw: string;
  try {
    const res = await fetch(`${cfg.baseUrl}${path}`, {
      method: init.method,
      headers: {
        authorization: `Bearer ${cfg.apiKey}`,
        accept: "application/json",
        ...(init.body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: controller.signal,
    });
    status = res.status;
    raw = await res.text();
  } catch {
    throw new AiProviderError(controller.signal.aborted ? timeoutMessage(cfg.timeoutMs) : CONNECTION_MESSAGE);
  } finally {
    clearTimeout(timer);
  }
  let body: unknown = null;
  try {
    body = JSON.parse(raw);
  } catch {
    // Non-JSON body (proxy error page, wrong base URL): judged by status below.
  }
  if (status < 200 || status >= 300) {
    const detail = (body as { error?: { message?: unknown } } | null)?.error?.message;
    throw new AiProviderError(statusMessage(status, safeDetail(detail, cfg.apiKey)));
  }
  if (body === null) throw new AiProviderError("The provider returned an unreadable response — check the base URL");
  return body;
}

interface ChatCompletion {
  model?: string;
  choices?: { message?: { content?: unknown; refusal?: unknown } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export async function openaiComplete(cfg: ProviderConfig, req: CompletionRequest): Promise<CompletionResult> {
  const messages = [...(req.system ? [{ role: "system", content: req.system }] : []), ...req.messages];
  const send = (limit: Record<string, number>) =>
    call(cfg, "/chat/completions", { method: "POST", body: { model: req.model, messages, ...limit } });
  let raw: unknown;
  try {
    raw = await send({ max_tokens: req.maxTokens });
  } catch (err) {
    // Newer OpenAI models (o-series, gpt-5) reject `max_tokens` and want
    // `max_completion_tokens`; most other compatible servers only know the former.
    if (!(err instanceof AiProviderError) || !err.message.includes("max_completion_tokens")) throw err;
    raw = await send({ max_completion_tokens: req.maxTokens });
  }
  const body = raw as ChatCompletion;
  const message = body.choices?.[0]?.message;
  if (!message) throw new AiProviderError("The provider returned no completion");
  if (typeof message.refusal === "string" && message.refusal) throw new AiProviderError(REFUSAL_MESSAGE);
  return {
    text: typeof message.content === "string" ? message.content : "",
    model: body.model ?? req.model,
    usage: { inputTokens: body.usage?.prompt_tokens ?? 0, outputTokens: body.usage?.completion_tokens ?? 0 },
  };
}

export async function openaiListModels(cfg: ProviderConfig): Promise<string[]> {
  const body = (await call(cfg, "/models", { method: "GET" })) as { data?: { id?: unknown }[] };
  return (body.data ?? [])
    .map((m) => m.id)
    .filter((id): id is string => typeof id === "string")
    .slice(0, MODELS_CAP);
}
