import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

const ai = vi.hoisted(() => ({ complete: vi.fn() }));
vi.mock("../../../lib/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/ai")>()),
  aiComplete: ai.complete,
}));

import { createApp } from "../../../app";
import { initModels, AiConnection, Organization, Role, User } from "../../../db/models";
import { hashPassword } from "../../../lib/password";
import { grantActions, resetDb } from "../../../../test/helpers";
import { loadFeatures } from "./registry";

const app = createApp();
const reply = (text: string) => ({ text, model: "m-test", provider: "openai", usage: { inputTokens: 1, outputTokens: 1 }, latencyMs: 1 });

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

async function login(username: string, actions: string[], orgCode = "Tenant") {
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
  return `Bearer ${res.body.data.accessToken}`;
}

async function enableAi() {
  const so = await org("ServiceOwner", "ServiceOwner");
  await AiConnection.create({
    orgId: so.id, provider: "openai", baseUrl: "https://llm.test/v1", model: "m-test", enabled: true,
    apiKeyCiphertext: null, apiKeyIv: null, apiKeyTag: null, apiKeyLast4: null,
    lastTestAt: null, lastTestOk: null, lastTestLatencyMs: null, lastTestError: null, updatedBy: null,
  });
}

const post = (auth: string, path: string, body: object) => request(app).post(path).set("authorization", auth).send(body);
const MS = ["ms.read", "ms.manage"];

// The platform AI connection belongs to the oldest ServiceOwner org, so a
// ServiceOwner left behind by an earlier test file would shadow this one's.
beforeAll(() => resetDb());

describe("doc-writer feature", () => {
  beforeEach(() => { ai.complete.mockReset(); });
  afterEach(() => resetDb());

  it("requires the management-system manage permission", async () => {
    await enableAi();
    const auth = await login("reader", ["ms.read"]);
    const res = await post(auth, "/v1/ai/features/doc-writer/improve-text", { text: "x", mode: "clarify" });
    expect(res.status).toBe(403);
    expect(ai.complete).not.toHaveBeenCalled();
  });

  it("policy-draft grounds the prompt in the org's records and returns only requested fields + known citations", async () => {
    await enableAi();
    const auth = await login("author", MS);
    const issue = await post(auth, "/v1/implementation/context", { title: "Cloud supplier dependency", data: { description: "Reliance on one hosting provider" } });
    expect(issue.status).toBe(201);
    const objective = await post(auth, "/v1/implementation/objectives", { title: "Reduce incidents", data: { name: "Reduce incidents", target: 5, unit: "per year" } });
    const policy = await post(auth, "/v1/implementation/policies", { title: "Information Security Policy", data: { category: "High-Level Policy", purpose: "Old purpose" } });
    const issueCode = issue.body.data.code as string;

    ai.complete.mockResolvedValueOnce(reply(JSON.stringify({
      fields: { purpose: `Protect information [${issueCode}].`, statement: "We commit…", scope: "ignored — not requested" },
      citations: [issueCode, "INVENTED-1"],
    })));
    const res = await post(auth, "/v1/ai/features/doc-writer/policy-draft", {
      policyId: policy.body.data.id, framework: "ISO/IEC 27001:2022", fields: ["purpose", "statement"], instructions: "Mention cloud",
    });
    expect(res.status).toBe(200);
    expect(res.body.data.fields).toEqual({ purpose: `Protect information [${issueCode}].`, statement: "We commit…" });
    expect(res.body.data.citations).toEqual([{ id: issueCode, label: `${issueCode} Cloud supplier dependency` }]);
    expect(res.body.data.generationId).toEqual(expect.any(String));

    const prompt = ai.complete.mock.calls[0][0].messages[0].content as string;
    expect(prompt).toContain("Reliance on one hosting provider");
    expect(prompt).toContain(objective.body.data.code);
    expect(prompt).toContain("Old purpose");
    expect(prompt).toContain("Mention cloud");
    expect(prompt).toContain("No clauses of");
  });

  it("policy-draft cannot read another tenant's policy", async () => {
    await enableAi();
    const other = await login("other", MS, "OtherTenant");
    const foreign = await post(other, "/v1/implementation/policies", { title: "Foreign", data: { category: "High-Level Policy" } });
    const auth = await login("author", MS);
    const res = await post(auth, "/v1/ai/features/doc-writer/policy-draft", { policyId: foreign.body.data.id, framework: "ISO 9001" });
    expect(res.status).toBe(404);
    expect(ai.complete).not.toHaveBeenCalled();
  });

  it("procedure-draft returns validated editor blocks", async () => {
    await enableAi();
    const auth = await login("author", MS);
    ai.complete.mockResolvedValueOnce(reply(JSON.stringify({ blocks: [
      { kind: "h1", text: "Purchasing" }, { kind: "table", text: "x" }, { kind: "ol", items: ["1. Request", "Approve"] },
    ] })));
    const res = await post(auth, "/v1/ai/features/doc-writer/procedure-draft", { title: "Purchasing" });
    expect(res.status).toBe(200);
    expect(res.body.data.blocks).toEqual([{ kind: "h1", text: "Purchasing" }, { kind: "ol", items: ["Request", "Approve"] }]);
  });

  it("improve-text and change-summary return drafts", async () => {
    await enableAi();
    const auth = await login("author", MS);
    ai.complete.mockResolvedValueOnce(reply("  Kebijakan ini berlaku.  "));
    const t = await post(auth, "/v1/ai/features/doc-writer/improve-text", { text: "This policy applies.", mode: "translate-id" });
    expect(t.body.data).toEqual({ text: "Kebijakan ini berlaku.", generationId: expect.any(String) });
    expect(ai.complete.mock.calls[0][0].system).toContain("Indonesian");

    ai.complete.mockResolvedValueOnce(reply(JSON.stringify({ summary: "A. B. C. D.", changes: ["Added step 3", " "] })));
    const c = await post(auth, "/v1/ai/features/doc-writer/change-summary", { before: "old", after: "new" });
    expect(c.body.data).toEqual({ summary: "A. B. C.", changes: ["Added step 3"], generationId: expect.any(String) });

    expect((await post(auth, "/v1/ai/features/doc-writer/change-summary", { before: "", after: " " })).status).toBe(400);
  });
});
