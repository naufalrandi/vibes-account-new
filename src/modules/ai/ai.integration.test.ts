import { describe, expect, it, beforeAll, afterEach, vi } from "vitest";
import { randomBytes } from "node:crypto";
import request from "supertest";
import { createApp } from "../../app";
import { env } from "../../config/env";
import { initModels, AiConnection, AuditLog, Organization, Role, User } from "../../db/models";
import { hashPassword } from "../../lib/password";
import { resetDb, grantActions } from "../../../test/helpers";

const app = createApp();
const KEY = "sk-test-SECRET-value-9876wxyz";
const READ = "ai.settings.read";
const MANAGE = "ai.settings.manage";

/** Every response body this file sees, so the key-never-returned check covers them all. */
const seen: string[] = [];
const track = <T extends { text: string }>(res: T): T => {
  seen.push(res.text);
  return res;
};

async function login(opts: { type: "ServiceOwner" | "Tenant"; superAdmin?: boolean; actions?: string[]; username: string }) {
  let org = await Organization.findOne({ where: { code: opts.type } });
  if (!org) {
    org = await Organization.create({
      name: opts.type, code: opts.type, type: opts.type, status: "Active",
      parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null,
    });
    if (opts.type === "Tenant") await org.update({ tenantId: org.id });
  }
  const user = await User.create({
    orgId: org.id, tenantId: opts.type === "Tenant" ? org.id : null, fullName: `Name ${opts.username}`, username: opts.username,
    email: `${opts.username}@x.test`, passwordHash: await hashPassword("ChangeMe123"), status: "Active",
    position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null,
  });
  const role = await Role.create({
    name: `R-${opts.username}`, tierScope: opts.type, orgId: org.id, isSuperAdmin: opts.superAdmin ?? false, status: true,
  });
  await (user as unknown as { setRoles: (roles: Role[]) => Promise<unknown> }).setRoles([role]);
  if (opts.actions?.length) await grantActions(role.id, opts.actions);
  const res = await request(app).post("/v1/auth/login").send({ identifier: opts.username, password: "ChangeMe123" });
  return { auth: `Bearer ${res.body.data.accessToken}` };
}

const soAdmin = () => login({ type: "ServiceOwner", superAdmin: true, username: "soadmin" });
const save = (auth: string, body: object) => request(app).put("/v1/ai/connection").set("authorization", auth).send(body).then(track);
const get = (auth: string, path = "/v1/ai/connection") => request(app).get(path).set("authorization", auth).then(track);
const post = (auth: string, path: string, body: object = {}) => request(app).post(path).set("authorization", auth).send(body).then(track);
const chatOk = (content = "OK") =>
  new Response(JSON.stringify({ model: "gpt-test", choices: [{ message: { content } }], usage: { prompt_tokens: 5, completion_tokens: 1 } }), { status: 200 });

const openaiConn = { provider: "openai", baseUrl: "https://llm.example.test/v1/", apiKey: KEY, model: "gpt-test", enabled: true };

describe("/v1/ai", () => {
  beforeAll(() => initModels());
  afterEach(async () => {
    vi.unstubAllGlobals();
    env.AI_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    await resetDb();
  });
  env.AI_ENCRYPTION_KEY = randomBytes(32).toString("base64");

  it("reports an unconfigured connection", async () => {
    const { auth } = await soAdmin();
    const res = await get(auth);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      configured: false, provider: null, baseUrl: null, model: null, enabled: false, hasApiKey: false, apiKeyHint: null,
      maxOutputTokens: 4096, timeoutMs: 60000, lastTest: null, updatedAt: null, updatedBy: null, encryptionReady: true,
    });
    expect((await get(auth, "/v1/ai/status")).body.data).toEqual({ available: false });
  });

  it("requires a key on first save and AI_ENCRYPTION_KEY to store one", async () => {
    const { auth } = await soAdmin();
    const noKey = await save(auth, { ...openaiConn, apiKey: "" });
    expect(noKey.status).toBe(400);
    expect(noKey.body.error.code).toBe("AI_API_KEY_REQUIRED");

    env.AI_ENCRYPTION_KEY = undefined;
    const missing = await save(auth, openaiConn);
    expect(missing.status).toBe(409);
    expect(missing.body.error).toEqual({ code: "AI_ENCRYPTION_KEY_MISSING", message: "Set AI_ENCRYPTION_KEY (32 bytes, base64) on the server" });
    expect((await get(auth)).body.data.encryptionReady).toBe(false);
  });

  it("saves encrypted, keeps the key on update, and never returns or audits it", async () => {
    const { auth } = await soAdmin();
    const first = await save(auth, openaiConn);
    expect(first.status).toBe(200);
    expect(first.body.data).toMatchObject({
      configured: true, provider: "openai", baseUrl: "https://llm.example.test/v1", model: "gpt-test", enabled: true,
      hasApiKey: true, apiKeyHint: "…wxyz", updatedBy: "Name soadmin",
    });
    const row = await AiConnection.findOne();
    expect(row!.apiKeyCiphertext).toBeTruthy();
    expect(JSON.stringify(row!.toJSON())).not.toContain(KEY);

    // No apiKey + a provider/base-URL change keeps the stored key.
    const second = await save(auth, { provider: "anthropic", model: "claude-x", enabled: false, maxOutputTokens: 2000 });
    expect(second.status).toBe(200);
    expect(second.body.data).toMatchObject({
      provider: "anthropic", baseUrl: "https://api.anthropic.com", model: "claude-x", enabled: false,
      hasApiKey: true, apiKeyHint: "…wxyz", maxOutputTokens: 2000, timeoutMs: 60000,
    });
    const after = await AiConnection.findOne();
    expect(after!.apiKeyCiphertext).toBe(row!.apiKeyCiphertext);

    const audits = await AuditLog.findAll({ where: { action: "ai.connection.saved" } });
    expect(audits).toHaveLength(2);
    expect(audits[0].get("metadata")).toMatchObject({ provider: "openai", baseUrlHost: "llm.example.test", model: "gpt-test" });
    expect(JSON.stringify(audits.map((a) => a.toJSON()))).not.toContain(KEY);
  });

  it("validates the body", async () => {
    const { auth } = await soAdmin();
    expect((await save(auth, { ...openaiConn, baseUrl: "ftp://x" })).status).toBe(400);
    expect((await save(auth, { ...openaiConn, model: "" })).status).toBe(400);
    expect((await save(auth, { ...openaiConn, maxOutputTokens: 100 })).status).toBe(400);
    expect((await save(auth, { ...openaiConn, timeoutMs: 1000 })).status).toBe(400);
  });

  it("tests the stored connection and records the result", async () => {
    const { auth } = await soAdmin();
    await save(auth, openaiConn);
    const fetchMock = vi.fn().mockResolvedValue(chatOk("OK"));
    vi.stubGlobal("fetch", fetchMock);

    const res = await post(auth, "/v1/ai/connection/test");
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ ok: true, model: "gpt-test", reply: "OK", error: null });
    expect(typeof res.body.data.latencyMs).toBe("number");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://llm.example.test/v1/chat/completions");
    expect(init.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(init.body)).toMatchObject({ max_tokens: 1024, messages: [{ role: "user", content: "Reply with the single word: OK" }] });

    const view = (await get(auth)).body.data;
    expect(view.lastTest).toMatchObject({ ok: true, error: null });
    expect(await AuditLog.count({ where: { action: "ai.connection.tested" } })).toBe(1);

    // Unsaved edits (another model) are tested but not recorded.
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { message: "bad key" } }), { status: 401 }));
    const edited = await post(auth, "/v1/ai/connection/test", { model: "other-model" });
    expect(edited.status).toBe(200);
    expect(edited.body.data).toEqual({ ok: false, latencyMs: null, model: "other-model", reply: null, error: "Invalid API key: bad key" });
    expect((await get(auth)).body.data.lastTest.ok).toBe(true);
  });

  it("returns 409 when there is nothing to test", async () => {
    const { auth } = await soAdmin();
    const res = await post(auth, "/v1/ai/connection/test");
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("AI_NOT_CONFIGURED");
  });

  it("lists models, and reports provider failure in-band", async () => {
    const { auth } = await soAdmin();
    await save(auth, openaiConn);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ id: "a" }, { id: "b" }] }), { status: 200 })));
    expect((await post(auth, "/v1/ai/connection/models")).body.data).toEqual({ models: ["a", "b"] });

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    const failed = await post(auth, "/v1/ai/connection/models", { apiKey: "sk-other-key-0000" });
    expect(failed.status).toBe(200);
    expect(failed.body.data).toEqual({ models: [], error: "Could not reach the provider — check the base URL" });
  });

  it("exposes availability to any user and deletes the connection", async () => {
    const { auth } = await soAdmin();
    await save(auth, openaiConn);
    const tenant = await login({ type: "Tenant", username: "tuser" });
    expect((await get(tenant.auth, "/v1/ai/status")).body.data).toEqual({ available: true });

    const del = await request(app).delete("/v1/ai/connection").set("authorization", auth).then(track);
    expect(del.body.data).toEqual({ deleted: true });
    expect((await get(auth)).body.data.configured).toBe(false);
    expect(await AuditLog.count({ where: { action: "ai.connection.deleted" } })).toBe(1);
    expect((await get(tenant.auth, "/v1/ai/status")).body.data).toEqual({ available: false });
  });

  it("enforces permissions: read-only SO user and tenants are refused", async () => {
    const reader = await login({ type: "ServiceOwner", actions: [READ], username: "reader" });
    expect((await get(reader.auth)).status).toBe(200);
    expect((await save(reader.auth, openaiConn)).status).toBe(403);
    expect((await post(reader.auth, "/v1/ai/connection/test")).status).toBe(403);

    const tenant = await login({ type: "Tenant", actions: [READ, MANAGE], username: "tadmin" });
    expect((await get(tenant.auth)).status).toBe(403);
    expect((await save(tenant.auth, openaiConn)).status).toBe(403);
    const tenantSuper = await login({ type: "Tenant", superAdmin: true, username: "tsuper" });
    expect((await get(tenantSuper.auth)).status).toBe(403);

    expect((await request(app).get("/v1/ai/status")).status).toBe(401);
  });

  it("never put the key in any response", () => {
    expect(seen.length).toBeGreaterThan(20);
    expect(seen.filter((body) => body.includes(KEY))).toEqual([]);
  });
});
