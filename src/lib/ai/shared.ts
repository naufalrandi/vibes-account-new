/** Types and error wording shared by the AI provider adapters. */

export type AiProviderName = "anthropic" | "openai";

export interface AiMessage {
  role: "user" | "assistant";
  content: string;
}

/** Everything an adapter needs to reach the provider. `apiKey` is plaintext and must never be logged or returned. */
export interface ProviderConfig {
  apiKey: string;
  baseUrl: string;
  timeoutMs: number;
}

export interface CompletionRequest {
  model: string;
  system?: string;
  messages: AiMessage[];
  maxTokens: number;
}

export interface CompletionResult {
  text: string;
  model: string;
  usage: { inputTokens: number; outputTokens: number };
}

export const DEFAULT_BASE_URLS: Record<AiProviderName, string> = {
  anthropic: "https://api.anthropic.com",
  openai: "https://api.openai.com/v1",
};

/** Trimmed, trailing slashes dropped; blank falls back to the provider default. */
export function normalizeBaseUrl(provider: AiProviderName, baseUrl?: string | null): string {
  const trimmed = (baseUrl ?? "").trim().replace(/\/+$/, "");
  return trimmed || DEFAULT_BASE_URLS[provider];
}

export const MODELS_CAP = 200;
const DETAIL_MAX = 300;

/** Provider-supplied detail, truncated, with the key scrubbed in case a provider echoes it. */
export function safeDetail(detail: unknown, apiKey: string): string | null {
  if (typeof detail !== "string" || !detail.trim()) return null;
  const scrubbed = apiKey ? detail.split(apiKey).join("***") : detail;
  return scrubbed.trim().slice(0, DETAIL_MAX);
}

/** User-facing message for a non-2xx provider response. */
export function statusMessage(status: number, detail: string | null): string {
  const base =
    status === 401 ? "Invalid API key"
    : status === 403 ? "The API key is not allowed to perform this request"
    : status === 404 ? "Model or endpoint not found"
    : status === 429 ? "Rate limited by the provider"
    : status >= 500 ? `The provider returned an error (HTTP ${status})`
    : `The provider rejected the request (HTTP ${status})`;
  return detail ? `${base}: ${detail}` : base;
}

export const timeoutMessage = (timeoutMs: number) => `The provider did not respond within ${Math.round(timeoutMs / 1000)}s`;
export const CONNECTION_MESSAGE = "Could not reach the provider — check the base URL";
export const REFUSAL_MESSAGE = "The model declined this request";
