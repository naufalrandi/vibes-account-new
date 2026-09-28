import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

const ai = vi.hoisted(() => ({ complete: vi.fn() }));
vi.mock("../../../lib/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/ai")>()),
  aiComplete: ai.complete,
}));

import { createApp } from "../../../app";
import { initModels, AiConnection, ImplementationRecord, KbArticle, Organization, Role, Ticket, User } from "../../../db/models";
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

const post = (auth: string, path: string, body: object) => request(app).post(path).set("authorization", auth).send(body);

// The platform AI connection belongs to the oldest ServiceOwner org, so a
// ServiceOwner left behind by an earlier test file would shadow this one's.
beforeAll(() => resetDb());

describe("triage feature", () => {
  beforeEach(async () => {
    ai.complete.mockReset();
    await enableAi();
  });
  afterEach(() => resetDb());

  it("suggests a concern class and lists open same-org duplicates found in code", async () => {
    const { auth, orgId } = await login("qa", ["ms.read"]);
    const other = await org("Tenant", "TenantB");
    const concern = await rec(orgId, "concerns", "CON-1", "Balance calibration overdue in lab 2", "Submitted", { description: "The lab 2 balance calibration sticker expired last month" });
    const nc = await rec(orgId, "nonconformities", "NC-7", "Lab 2 balance calibration overdue", "Open");
    await rec(orgId, "nonconformities", "NC-8", "Lab 2 balance calibration overdue", "Closed");
    await rec(other.id, "nonconformities", "NC-9", "Lab 2 balance calibration overdue", "Open");
    await rec(orgId, "concerns", "CON-2", "Invoice address wrong", "Submitted");
    ai.complete.mockResolvedValueOnce(reply('{"suggestedClass": "Duplicate", "rationale": "Same as [NC-7]", "routingNotes": "Link to NC-7"}'));

    const res = await post(auth, "/v1/ai/features/triage/concern", { concernId: concern.id });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ suggestedClass: "Duplicate", rationale: "Same as [NC-7]", routingNotes: "Link to NC-7", generationId: expect.any(String) });
    expect(res.body.data.possibleDuplicates).toEqual([{ id: nc.id, code: "NC-7", title: nc.title, reason: expect.stringContaining("open nonconformity") }]);
    expect(ai.complete.mock.calls[0][0].messages[0].content).toContain("[NC-7]");
  });

  it("rejects a class outside the six, another org's concern, and callers without ms access", async () => {
    const { auth, orgId } = await login("qa", ["ms.read"]);
    const concern = await rec(orgId, "concerns", "CON-1", "Something", "Submitted");
    ai.complete.mockResolvedValue(reply('{"suggestedClass": "Escalate", "rationale": "x", "routingNotes": "y"}'));
    expect((await post(auth, "/v1/ai/features/triage/concern", { concernId: concern.id })).status).toBe(502);

    const other = await login("qb", ["ms.read"], "TenantB");
    expect((await post(other.auth, "/v1/ai/features/triage/concern", { concernId: concern.id })).status).toBe(404);
    const none = await login("qc", []);
    expect((await post(none.auth, "/v1/ai/features/triage/concern", { concernId: concern.id })).status).toBe(403);
  });

  it("analyses a CSAT comment", async () => {
    const { auth, orgId } = await login("qa", ["ms.manage"]);
    const r = await rec(orgId, "customer-satisfaction", "CSAT-1", "Q3 survey", "New", { comment: "Delivery was late twice. Call me on +62 812-3456-7890", score: 2 });
    ai.complete.mockResolvedValueOnce(reply('{"sentiment": "negative", "themes": ["late delivery"], "suggestedRoute": "NC", "rationale": "Delivery requirement missed"}'));
    const res = await post(auth, "/v1/ai/features/triage/csat", { recordId: r.id });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ sentiment: "negative", themes: ["late delivery"], suggestedRoute: "NC", rationale: "Delivery requirement missed", generationId: expect.any(String) });
    expect(ai.complete.mock.calls[0][0].messages[0].content).not.toContain("3456");
  });

  it("drafts a ticket category, priority and a reply grounded on published KB articles", async () => {
    const { auth, orgId } = await login("agent", ["ticket.read"]);
    const kb = await KbArticle.create({ orgId: null, code: "KB-2026-0001", title: "Reset your password", category: "platform", status: "Published", content: "Use Forgot password on the login page to reset your password." } as never);
    await KbArticle.create({ orgId: null, code: "KB-2026-0002", title: "Reset your password (draft)", category: "platform", status: "Draft", content: "reset password" } as never);
    const t = await Ticket.create({
      code: "TKT-2026-0001", subject: "Cannot reset password", description: "I forgot my password and cannot reset it", scope: "tenant",
      orgId, createdBy: { name: "u", email: "" }, managedBy: null, assignedTo: null,
    } as never);
    ai.complete.mockResolvedValueOnce(reply(JSON.stringify({ category: "Technical Support", priority: "Medium", draftReply: `Please use Forgot password [${kb.id}]`, citedArticleIds: [kb.id], kbHasAnswer: true })));
    const res = await post(auth, "/v1/ai/features/triage/ticket", { ticketId: t.id });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      category: "Technical Support", priority: "Medium", draftReply: `Please use Forgot password [${kb.id}]`, kbHasAnswer: true,
      relatedArticles: [{ id: kb.id, title: "Reset your password" }], generationId: expect.any(String),
    });
    const prompt = ai.complete.mock.calls[0][0].messages[0].content as string;
    expect(prompt).toContain(`[${kb.id}]`);
    expect(prompt).not.toContain("(draft)");
  });

  it("says when no KB article matches a ticket", async () => {
    const { auth, orgId } = await login("agent", ["ticket.manage"]);
    const t = await Ticket.create({ code: "TKT-2026-0002", subject: "Refund", description: "Refund my invoice", scope: "tenant", orgId, createdBy: { name: "u", email: "" }, managedBy: null, assignedTo: null } as never);
    ai.complete.mockResolvedValueOnce(reply('{"category": "Billing", "priority": "Low", "draftReply": "We are looking into it.", "citedArticleIds": [], "kbHasAnswer": true}'));
    const res = await post(auth, "/v1/ai/features/triage/ticket", { ticketId: t.id });
    expect(res.body.data).toMatchObject({ category: "Billing", kbHasAnswer: false, relatedArticles: [] });
    expect(ai.complete.mock.calls[0][0].messages[0].content).toContain("No published knowledge base article matches");
  });
});
