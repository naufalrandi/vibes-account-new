import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

const ai = vi.hoisted(() => ({ complete: vi.fn() }));
vi.mock("../../../lib/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/ai")>()),
  aiComplete: ai.complete,
}));

import { createApp } from "../../../app";
import { initModels, AiConnection, ImplementationRecord, Organization, Role, User } from "../../../db/models";
import { hashPassword } from "../../../lib/password";
import { grantActions, resetDb } from "../../../../test/helpers";
import { loadFeatures } from "./registry";

const app = createApp();
const reply = (json: object) => ({ text: JSON.stringify(json), model: "m-test", provider: "openai", usage: { inputTokens: 1, outputTokens: 1 }, latencyMs: 1 });

beforeAll(async () => {
  initModels();
  await loadFeatures();
});

async function org(type: "ServiceOwner" | "Tenant", code: string): Promise<Organization> {
  const existing = await Organization.findOne({ where: { code } });
  if (existing) return existing;
  const o = await Organization.create({
    name: code, code, type, status: "Active", parentOrgId: null, tenantId: null,
    email: null, phone: null, website: null, country: null, address: null,
  });
  return type === "Tenant" ? o.update({ tenantId: o.id }) : o;
}

async function login(username: string, actions: string[], orgCode = "TenantA") {
  const o = await org("Tenant", orgCode);
  const user = await User.create({
    orgId: o.id, tenantId: o.id, fullName: username, username, email: `${username}@x.test`,
    passwordHash: await hashPassword("ChangeMe123"), status: "Active", position: null, workUnit: null, lastLogin: null,
    activationToken: null, resetToken: null, resetExpires: null,
  });
  const role = await Role.create({ name: `R-${username}`, tierScope: "Tenant", orgId: o.id, isSuperAdmin: false, status: true });
  await (user as unknown as { setRoles: (r: Role[]) => Promise<unknown> }).setRoles([role]);
  if (actions.length) await grantActions(role.id, actions);
  const res = await request(app).post("/v1/auth/login").send({ identifier: username, password: "ChangeMe123" });
  return { auth: `Bearer ${res.body.data.accessToken}`, orgId: o.id };
}

async function enableAi() {
  const so = await org("ServiceOwner", "ServiceOwner");
  await AiConnection.create({
    orgId: so.id, provider: "openai", baseUrl: "https://llm.test/v1", model: "m-test", enabled: true,
    apiKeyCiphertext: null, apiKeyIv: null, apiKeyTag: null, apiKeyLast4: null,
    lastTestAt: null, lastTestOk: null, lastTestLatencyMs: null, lastTestError: null, updatedBy: null,
  });
}

const rec = (orgId: string, module: string, code: string, title: string, status: string, data: object = {}) =>
  ImplementationRecord.create({ orgId, module, code, title, status, owner: null, data, elementId: null, frameworks: [] });

const ask = (auth: string, body: object) => request(app).post("/v1/ai/features/ask-vibes/ask").set("authorization", auth).send(body);
const promptOf = (call: number) => ai.complete.mock.calls[call][0].messages[0].content as string;

// The platform AI connection belongs to the oldest ServiceOwner org, so a
// ServiceOwner left behind by an earlier test file would shadow this one's.
beforeAll(() => resetDb());

describe("ask-vibes feature", () => {
  beforeEach(async () => {
    ai.complete.mockReset();
    await enableAi();
  });
  afterEach(() => resetDb());

  it("runs the picked tools on the caller's org only, denies unpermitted ones and keeps real citations", async () => {
    const { auth, orgId } = await login("qa", ["ms.read"]);
    const other = await org("Tenant", "TenantB");
    const nc = await rec(orgId, "nonconformities", "NC-1", "Leaking valve", "Open", { due: "2026-01-10", severity: "Major" });
    await rec(orgId, "nonconformities", "NC-2", "Old issue", "Closed");
    await rec(other.id, "nonconformities", "NC-9", "Other tenant NC", "Open");
    ai.complete
      .mockResolvedValueOnce(reply({ tools: [{ tool: "list_nonconformities", args: {} }, { tool: "audit_findings", args: { period: "all" } }] }))
      .mockResolvedValueOnce(reply({ answer: "One open NC: NC-1.", citations: ["NC-1", "NC-9"], moreTools: [] }));

    const res = await ask(auth, { question: "Which nonconformities are open?", history: [{ role: "user", content: "hi" }, { role: "assistant", content: "hello" }] });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      answer: "One open NC: NC-1.",
      citations: [{ type: "nonconformity", id: nc.id, code: "NC-1", label: "NC-1 — Leaking valve" }],
      toolsUsed: ["list_nonconformities"],
    });
    expect(res.body.data.generationIds).toHaveLength(2);
    const results = promptOf(1);
    expect(results).toContain("NC-1");
    expect(results).not.toContain("NC-2");
    expect(results).not.toContain("NC-9");
    expect(results).toContain('"denied":true');
    expect(promptOf(0)).toContain("Assistant: hello");
  });

  it("allows one extra tool round, then forces an answer", async () => {
    const { auth, orgId } = await login("qa", ["ms.read"]);
    await rec(orgId, "objectives", "OBJ-1", "Reduce complaints", "Open", { target: "10", actual: "12" });
    ai.complete
      .mockResolvedValueOnce(reply({ tools: [{ tool: "risk_summary", args: {} }] }))
      .mockResolvedValueOnce(reply({ answer: "", citations: [], moreTools: [{ tool: "objectives_status", args: {} }] }))
      .mockResolvedValueOnce(reply({ answer: "OBJ-1 is behind target.", citations: ["OBJ-1"], moreTools: [{ tool: "kpi_status", args: {} }] }));

    const res = await ask(auth, { question: "How are we doing?" });
    expect(res.status).toBe(200);
    expect(ai.complete).toHaveBeenCalledTimes(3);
    expect(res.body.data.toolsUsed).toEqual(["risk_summary", "objectives_status"]);
    expect(res.body.data.citations.map((c: { code: string }) => c.code)).toEqual(["OBJ-1"]);
  });

  it("answers without tools when none is relevant", async () => {
    const { auth } = await login("qa", []);
    ai.complete
      .mockResolvedValueOnce(reply({ tools: [] }))
      .mockResolvedValueOnce(reply({ answer: "Hello! Ask me about your registers.", citations: [], moreTools: [] }));
    const res = await ask(auth, { question: "Hello" });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ toolsUsed: [], citations: [] });
  });

  it("validates the input", async () => {
    const { auth } = await login("qa", []);
    expect((await ask(auth, { question: "x".repeat(2001) })).status).toBe(400);
    expect((await ask(auth, { question: "hi", history: Array.from({ length: 11 }, () => ({ role: "user", content: "x" })) })).status).toBe(400);
  });
});
