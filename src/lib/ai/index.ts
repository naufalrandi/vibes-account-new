/**
 * Platform AI — the single entry point for every AI feature.
 *
 *   const { text } = await aiComplete({ system, messages: [{ role: "user", content }] });
 *
 * Resolves the platform connection (the Service Owner org's `ai_connections`
 * row, configured under Organization Settings → AI via /v1/ai/connection),
 * decrypts its key and calls the configured provider. Throws
 * AiNotConfiguredError (409 AI_NOT_CONFIGURED) when there is no enabled
 * connection, and AiProviderError (502 AI_PROVIDER_ERROR, safe message) when the
 * provider fails. Callers never see the key, the provider or the base URL.
 * `maxTokens` is capped at the connection's `maxOutputTokens`.
 */
import { AiConnection, Organization } from "../../db/models";
import { AiNotConfiguredError, ConflictError } from "../errors";
import { aiEncryptionKey, open } from "../secretBox";
import { anthropicComplete, anthropicListModels } from "./anthropic";
import { openaiComplete, openaiListModels } from "./openaiCompatible";
import type { AiMessage, AiProviderName, CompletionRequest, CompletionResult, ProviderConfig } from "./shared";

export * from "./shared";

export interface AiCompleteInput {
  system?: string;
  messages: AiMessage[];
  maxTokens?: number;
}

export interface AiCompletion extends CompletionResult {
  provider: AiProviderName;
  latencyMs: number;
}

const PROVIDERS = {
  anthropic: { complete: anthropicComplete, listModels: anthropicListModels },
  openai: { complete: openaiComplete, listModels: openaiListModels },
} satisfies Record<AiProviderName, unknown>;

export const encryptionKeyMissing = () =>
  new ConflictError("Set AI_ENCRYPTION_KEY (32 bytes, base64) on the server", "AI_ENCRYPTION_KEY_MISSING");

/** The org whose connection is the platform's: the (first) Service Owner. */
export async function platformOrgId(): Promise<string | null> {
  const so = await Organization.findOne({ where: { type: "ServiceOwner" }, order: [["createdAt", "ASC"]], attributes: ["id"] });
  return so?.id ?? null;
}

export async function platformConnection(): Promise<AiConnection | null> {
  const orgId = await platformOrgId();
  return orgId ? AiConnection.findOne({ where: { orgId } }) : null;
}

/** The stored key in plaintext, or null when none is stored. */
export function storedApiKey(conn: AiConnection): string | null {
  if (!conn.apiKeyCiphertext || !conn.apiKeyIv || !conn.apiKeyTag) return null;
  const key = aiEncryptionKey();
  if (!key) throw encryptionKeyMissing();
  try {
    return open({ ciphertext: conn.apiKeyCiphertext, iv: conn.apiKeyIv, tag: conn.apiKeyTag }, key);
  } catch {
    throw new AiNotConfiguredError("The stored AI API key cannot be decrypted (AI_ENCRYPTION_KEY changed?) — enter the key again");
  }
}

export async function runCompletion(provider: AiProviderName, cfg: ProviderConfig, req: CompletionRequest): Promise<AiCompletion> {
  const started = Date.now();
  const result = await PROVIDERS[provider].complete(cfg, req);
  return { ...result, provider, latencyMs: Date.now() - started };
}

export function listProviderModels(provider: AiProviderName, cfg: ProviderConfig): Promise<string[]> {
  return PROVIDERS[provider].listModels(cfg);
}

export async function isAiAvailable(): Promise<boolean> {
  return !!(await platformConnection())?.enabled;
}

export async function aiComplete(input: AiCompleteInput): Promise<AiCompletion> {
  const conn = await platformConnection();
  if (!conn?.enabled) throw new AiNotConfiguredError();
  const apiKey = storedApiKey(conn);
  if (!apiKey) throw new AiNotConfiguredError();
  return runCompletion(
    conn.provider,
    { apiKey, baseUrl: conn.baseUrl, timeoutMs: conn.timeoutMs },
    {
      model: conn.model,
      system: input.system,
      messages: input.messages,
      maxTokens: Math.min(input.maxTokens ?? conn.maxOutputTokens, conn.maxOutputTokens),
    },
  );
}
