import { AiConnection, User } from "../../db/models";
import { writeAudit } from "../audit/audit.service";
import { AiNotConfiguredError, AiProviderError, BadRequestError, ConflictError, ForbiddenError } from "../../lib/errors";
import { aiEncryptionKey, seal } from "../../lib/secretBox";
import type { AuthContext } from "../../lib/scope";
import {
  encryptionKeyMissing, listProviderModels, normalizeBaseUrl, platformOrgId, runCompletion, storedApiKey,
  type AiProviderName,
} from "../../lib/ai";

/**
 * Settings for the platform AI connection (src/lib/ai). Service Owner only:
 * the route grants (ai.settings.*) are SP-only, and every function here also
 * refuses a non-SO caller. The API key goes in, never comes out — responses
 * carry only `hasApiKey` and a last-four hint, audit metadata only the
 * provider, base-URL host and model.
 */

const DEFAULT_MAX_OUTPUT_TOKENS = 4096;
const DEFAULT_TIMEOUT_MS = 60_000;
const TEST_PROMPT = "Reply with the single word: OK";
const TEST_MAX_TOKENS = 1024;
const REPLY_PREVIEW = 200;

export interface AiConnectionView {
  configured: boolean;
  provider: AiProviderName | null;
  baseUrl: string | null;
  model: string | null;
  enabled: boolean;
  hasApiKey: boolean;
  apiKeyHint: string | null;
  maxOutputTokens: number;
  timeoutMs: number;
  lastTest: { at: string; ok: boolean; latencyMs: number | null; error: string | null } | null;
  updatedAt: string | null;
  updatedBy: string | null;
  encryptionReady: boolean;
}

export interface SaveInput {
  provider: AiProviderName;
  baseUrl?: string | null;
  apiKey?: string | null;
  model: string;
  enabled: boolean;
  maxOutputTokens?: number;
  timeoutMs?: number;
}

/** Unsaved edits to try; anything omitted falls back to the stored connection. */
export interface TryInput {
  provider?: AiProviderName;
  baseUrl?: string | null;
  apiKey?: string | null;
  model?: string | null;
}

export interface TestResult {
  ok: boolean;
  latencyMs: number | null;
  model: string | null;
  reply: string | null;
  error: string | null;
}

function assertServiceOwner(auth: AuthContext): void {
  if (auth.orgType !== "ServiceOwner") throw new ForbiddenError("The AI connection is managed by the Service Owner");
}

async function ownerOrgId(): Promise<string> {
  const orgId = await platformOrgId();
  if (!orgId) throw new ConflictError("No Service Owner organization exists");
  return orgId;
}

const host = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
};

async function findConnection(orgId: string): Promise<AiConnection | null> {
  return AiConnection.findOne({ where: { orgId }, include: [{ model: User, as: "updater", attributes: ["fullName"] }] });
}

function toView(conn: AiConnection | null): AiConnectionView {
  const updater = (conn as unknown as { updater?: User | null } | null)?.updater;
  return {
    configured: !!conn,
    provider: conn?.provider ?? null,
    baseUrl: conn?.baseUrl ?? null,
    model: conn?.model ?? null,
    enabled: conn?.enabled ?? false,
    hasApiKey: !!conn?.apiKeyCiphertext,
    apiKeyHint: conn?.apiKeyLast4 ? `…${conn.apiKeyLast4}` : null,
    maxOutputTokens: conn?.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
    timeoutMs: conn?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    lastTest: conn?.lastTestAt
      ? { at: conn.lastTestAt.toISOString(), ok: !!conn.lastTestOk, latencyMs: conn.lastTestLatencyMs, error: conn.lastTestError }
      : null,
    updatedAt: conn ? conn.updatedAt.toISOString() : null,
    updatedBy: updater?.fullName ?? null,
    encryptionReady: !!aiEncryptionKey(),
  };
}

export async function getConnection(auth: AuthContext): Promise<AiConnectionView> {
  assertServiceOwner(auth);
  return toView(await findConnection(await ownerOrgId()));
}

export async function saveConnection(auth: AuthContext, input: SaveInput, ip: string | null): Promise<AiConnectionView> {
  assertServiceOwner(auth);
  const orgId = await ownerOrgId();
  const existing = await AiConnection.findOne({ where: { orgId } });
  const newKey = input.apiKey?.trim() || null;
  if (!newKey && !existing?.apiKeyCiphertext) throw new BadRequestError("Enter an API key", "AI_API_KEY_REQUIRED");
  let keyFields = {};
  if (newKey) {
    const key = aiEncryptionKey();
    if (!key) throw encryptionKeyMissing();
    const sealed = seal(newKey, key);
    keyFields = {
      apiKeyCiphertext: sealed.ciphertext,
      apiKeyIv: sealed.iv,
      apiKeyTag: sealed.tag,
      apiKeyLast4: newKey.length >= 8 ? newKey.slice(-4) : null,
    };
  }
  const baseUrl = normalizeBaseUrl(input.provider, input.baseUrl);
  const model = input.model.trim();
  // A last test of a different endpoint, model or key says nothing about this one.
  const staleTest =
    !existing || !!newKey || existing.provider !== input.provider || existing.baseUrl !== baseUrl || existing.model !== model;
  const values = {
    provider: input.provider,
    baseUrl,
    model,
    enabled: input.enabled,
    maxOutputTokens: input.maxOutputTokens ?? existing?.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
    timeoutMs: input.timeoutMs ?? existing?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    updatedBy: auth.userId,
    ...keyFields,
    ...(staleTest ? { lastTestAt: null, lastTestOk: null, lastTestLatencyMs: null, lastTestError: null } : {}),
  };
  const conn = existing
    ? await existing.update(values)
    : await AiConnection.create({
        orgId, apiKeyCiphertext: null, apiKeyIv: null, apiKeyTag: null, apiKeyLast4: null,
        lastTestAt: null, lastTestOk: null, lastTestLatencyMs: null, lastTestError: null, ...values,
      });
  await writeAudit({
    actorUserId: auth.userId,
    organizationId: orgId,
    tenantId: null,
    action: "ai.connection.saved",
    entityType: "AiConnection",
    entityId: conn.id,
    sourceIp: ip,
    result: "Success",
    metadata: { provider: conn.provider, baseUrlHost: host(conn.baseUrl), model: conn.model, enabled: conn.enabled, apiKeyChanged: !!newKey },
  });
  return toView(await findConnection(orgId));
}

export async function deleteConnection(auth: AuthContext, ip: string | null): Promise<{ deleted: true }> {
  assertServiceOwner(auth);
  const orgId = await ownerOrgId();
  const existing = await AiConnection.findOne({ where: { orgId } });
  if (existing) {
    await existing.destroy();
    await writeAudit({
      actorUserId: auth.userId,
      organizationId: orgId,
      tenantId: null,
      action: "ai.connection.deleted",
      entityType: "AiConnection",
      entityId: existing.id,
      sourceIp: ip,
      result: "Success",
      metadata: { provider: existing.provider, baseUrlHost: host(existing.baseUrl), model: existing.model },
    });
  }
  return { deleted: true };
}

/** Provider, base URL and key to use: the request's, else the stored connection's. */
function resolveTarget(existing: AiConnection | null, input: TryInput) {
  const provider = input.provider ?? existing?.provider;
  if (!provider) throw new AiNotConfiguredError("Nothing to test — choose a provider and enter an API key");
  // A stored base URL belongs to the stored provider; a different provider starts from its default.
  const baseUrl = normalizeBaseUrl(provider, input.baseUrl || (provider === existing?.provider ? existing.baseUrl : null));
  const sentKey = input.apiKey?.trim() || null;
  let stored: string | null = null;
  if (!sentKey) stored = existing ? storedApiKey(existing) : null;
  else if (existing?.apiKeyCiphertext && aiEncryptionKey()) {
    try {
      stored = storedApiKey(existing);
    } catch {
      stored = null; // unreadable stored key: the sent one is simply "different"
    }
  }
  const apiKey = sentKey ?? stored;
  if (!apiKey) throw new AiNotConfiguredError("Nothing to test — enter an API key");
  return {
    provider,
    config: { apiKey, baseUrl, timeoutMs: existing?.timeoutMs ?? DEFAULT_TIMEOUT_MS },
    usesStoredKey: stored !== null && apiKey === stored,
  };
}

export async function testConnection(auth: AuthContext, input: TryInput, ip: string | null): Promise<TestResult> {
  assertServiceOwner(auth);
  const orgId = await ownerOrgId();
  const existing = await AiConnection.findOne({ where: { orgId } });
  const target = resolveTarget(existing, input);
  const model = input.model?.trim() || existing?.model;
  if (!model) throw new BadRequestError("Choose a model to test", "AI_MODEL_REQUIRED");

  let result: TestResult;
  try {
    const r = await runCompletion(target.provider, target.config, {
      model,
      messages: [{ role: "user", content: TEST_PROMPT }],
      maxTokens: TEST_MAX_TOKENS,
    });
    result = { ok: true, latencyMs: r.latencyMs, model: r.model, reply: r.text.slice(0, REPLY_PREVIEW), error: null };
  } catch (err) {
    if (!(err instanceof AiProviderError)) throw err;
    result = { ok: false, latencyMs: null, model, reply: null, error: err.message };
  }

  const testedStored =
    !!existing &&
    target.usesStoredKey &&
    target.provider === existing.provider &&
    target.config.baseUrl === existing.baseUrl &&
    model === existing.model;
  if (existing && testedStored) {
    await existing.update({
      lastTestAt: new Date(), lastTestOk: result.ok, lastTestLatencyMs: result.latencyMs, lastTestError: result.error,
    });
  }
  await writeAudit({
    actorUserId: auth.userId,
    organizationId: orgId,
    tenantId: null,
    action: "ai.connection.tested",
    entityType: "AiConnection",
    entityId: existing?.id ?? null,
    sourceIp: ip,
    result: result.ok ? "Success" : "Failure",
    metadata: { provider: target.provider, baseUrlHost: host(target.config.baseUrl), model, savedConnection: testedStored },
  });
  return result;
}

export async function listModels(auth: AuthContext, input: TryInput): Promise<{ models: string[] } | { models: string[]; error: string }> {
  assertServiceOwner(auth);
  const existing = await AiConnection.findOne({ where: { orgId: await ownerOrgId() } });
  const target = resolveTarget(existing, input);
  try {
    return { models: await listProviderModels(target.provider, target.config) };
  } catch (err) {
    if (!(err instanceof AiProviderError)) throw err;
    return { models: [], error: err.message };
  }
}
