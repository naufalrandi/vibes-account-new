import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

const ai = vi.hoisted(() => ({ complete: vi.fn() }));
vi.mock("../../../lib/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/ai")>()),
  aiComplete: ai.complete,
}));

import { createApp } from "../../../app";
import {
  initModels, AiConnection, AiFeatureFlag, AiGeneration, CmsPage, CmsPost, KbArticle, Organization, Role, Ticket, User,
} from "../../../db/models";
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

async function login(username: string, actions: string[], type: "ServiceOwner" | "Tenant" = "Tenant", orgCode = "TenantA") {
  const o = await org(type, orgCode);
  const user = await User.create({
    orgId: o.id, tenantId: type === "Tenant" ? o.id : null, fullName: username, username, email: `${username}@x.test`,
    passwordHash: await hashPassword("ChangeMe123"), status: "Active", position: null, workUnit: null, lastLogin: null,
    activationToken: null, resetToken: null, resetExpires: null,
  });
  const role = await Role.create({ name: `R-${username}`, tierScope: type, orgId: o.id, isSuperAdmin: false, status: true });
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
  return so;
}

const article = (code: string, title: string, content: string, status = "Published", orgId: string | null = null) =>
  KbArticle.create({ orgId, code, title, category: "platform", status, content } as never);

const post = (auth: string, path: string, body: object) => request(app).post(path).set("authorization", auth).send(body);

// The platform AI connection belongs to the oldest ServiceOwner org, so a
// ServiceOwner left behind by an earlier test file would shadow this one's.
beforeAll(() => resetDb());

describe("kb-assistant feature", () => {
  beforeEach(async () => {
    ai.complete.mockReset();
    await enableAi();
  });
  afterEach(() => resetDb());

  it("answers only from Published articles and keeps citations to retrieved ones", async () => {
    const { auth } = await login("reader", ["kb.read"]);
    const kb = await article("KB-2026-0001", "Reset your password", "Use Forgot password on the login page to reset your password.");
    await article("KB-2026-0002", "Reset password internals", "reset password secret draft", "Draft");
    ai.complete.mockResolvedValueOnce(reply(JSON.stringify({ answer: "Use Forgot password [1].", answered: true, sourceIds: ["1", "7"] })));

    const res = await post(auth, "/v1/ai/features/kb-assistant/answer", { question: "How do I reset my password?" });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ answered: true, citations: [{ articleId: kb.id, title: "Reset your password" }] });
    expect(res.body.data.generationId).toEqual(expect.any(String));
    const prompt = ai.complete.mock.calls[0][0].messages[0].content as string;
    expect(prompt).toContain("Forgot password");
    expect(prompt).not.toContain("secret draft");
  });

  it("says the KB doesn't cover it without calling the model when nothing matches", async () => {
    const { auth } = await login("reader", ["kb.read"]);
    await article("KB-2026-0001", "Invoices", "How invoices are issued.");
    const res = await post(auth, "/v1/ai/features/kb-assistant/answer", { question: "zebra migration patterns" });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ answered: false, citations: [], generationId: null });
    expect(ai.complete).not.toHaveBeenCalled();
  });

  it("treats an uncited answer as not answered", async () => {
    const { auth } = await login("reader", ["kb.read"]);
    await article("KB-2026-0001", "Reset your password", "Use Forgot password.");
    ai.complete.mockResolvedValueOnce(reply(JSON.stringify({ answer: "Call support on 555.", answered: true, sourceIds: [] })));
    const res = await post(auth, "/v1/ai/features/kb-assistant/answer", { question: "reset password" });
    expect(res.body.data.answered).toBe(false);
    expect(res.body.data.answer).not.toContain("555");
  });

  it("drafts an article from a ticket for the Service Owner, without personal data", async () => {
    const { auth, orgId } = await login("sp", ["kb.read", "kb.manage", "ticket.read"], "ServiceOwner", "ServiceOwner");
    const t = await Ticket.create({
      code: "TKT-2026-0001", subject: "Cannot export report", description: "Export fails, mail me at jane@acme.test", scope: "tenant",
      orgId, createdBy: { name: "Jane", email: "jane@acme.test" }, managedBy: null, assignedTo: null,
      messages: [{ author: { name: "Bob Support", kind: "support" }, text: "Clear the browser cache and retry.", ts: new Date().toISOString() }],
    } as never);
    ai.complete.mockResolvedValueOnce(reply(JSON.stringify({
      title: "Report export fails", summary: "Fix a failing report export.", content: "## Problem\n...\n## Solution\n1. Clear cache",
      keywords: ["export", "report"], category: "troubleshooting",
    })));

    const res = await post(auth, "/v1/ai/features/kb-assistant/article-from-ticket", { ticketId: t.id });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ title: "Report export fails", category: "troubleshooting", ticketCode: "TKT-2026-0001" });
    const prompt = ai.complete.mock.calls[0][0].messages[0].content as string;
    expect(prompt).not.toContain("jane@acme.test");
    expect(prompt).not.toContain("Bob Support");
    expect(await KbArticle.count()).toBe(0); // draft only, nothing saved
  });

  it("refuses article drafting outside the Service Owner", async () => {
    const { auth, orgId } = await login("tm", ["kb.read", "kb.manage", "ticket.read"]);
    const t = await Ticket.create({ code: "TKT-2026-0002", subject: "x", description: "y", scope: "tenant", orgId, createdBy: { name: "u", email: "" }, managedBy: null, assignedTo: null } as never);
    const res = await post(auth, "/v1/ai/features/kb-assistant/article-from-ticket", { ticketId: t.id });
    expect(res.status).toBe(403);
    expect(ai.complete).not.toHaveBeenCalled();
  });
});

describe("public KB assistant (/v1/public/ai/kb/:orgId)", () => {
  beforeEach(() => { ai.complete.mockReset(); });
  afterEach(() => resetDb());

  const ask = (orgId: string, body: object) => request(app).post(`/v1/public/ai/kb/${orgId}`).send(body);
  const kbPost = (orgId: string, slug: string, title: string, body: string, status = "Published", category = "Exelera Knowledge Base") =>
    CmsPost.create({ orgId, title, slug, author: null, category, tags: [], status, excerpt: null, body, publishDate: null, createdBy: null } as never);

  it("answers from the org's published KB posts and logs the generation without a user", async () => {
    const so = await enableAi();
    await kbPost(so.id, "certification-steps", "Certification steps", "Certification starts with an application, then a stage 1 audit.");
    await kbPost(so.id, "draft-post", "Certification secret", "certification internal draft", "Draft");
    await kbPost(so.id, "news", "Certification news", "certification press release", "Published", "Exelera News");
    ai.complete.mockResolvedValueOnce(reply(JSON.stringify({ answer: "Apply, then a stage 1 audit [1].", answered: true, sourceIds: ["1"] })));

    const res = await ask(so.id, { question: "How does certification start?" });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ answer: "Apply, then a stage 1 audit [1].", answered: true, citations: [{ title: "Certification steps", slug: "certification-steps" }] });
    const prompt = ai.complete.mock.calls[0][0].messages[0].content as string;
    expect(prompt).not.toContain("internal draft");
    expect(prompt).not.toContain("press release");
    const gen = await AiGeneration.findOne({ where: { orgId: so.id, feature: "kb-assistant" } });
    expect(gen?.userId).toBeNull();
  });

  it("404s for an org without a public site and when the feature is off", async () => {
    const so = await enableAi();
    const tenant = await org("Tenant", "NoSite");
    expect((await ask(tenant.id, { question: "hi there" })).status).toBe(404);
    expect((await ask("not-a-uuid", { question: "hi there" })).status).toBe(404);

    await CmsPage.create({ orgId: tenant.id, title: "Home", slug: "home", path: null, template: "Landing", status: "Published", author: null, seoTitle: null, seoDesc: null, body: "Hi", createdBy: null });
    await AiFeatureFlag.create({ orgId: tenant.id, feature: "kb-assistant", enabled: false, updatedBy: null });
    expect((await ask(tenant.id, { question: "hi there" })).status).toBe(404);
    await AiFeatureFlag.create({ orgId: so.id, feature: "kb-assistant", enabled: false, updatedBy: null });
    expect((await ask(so.id, { question: "hi there" })).status).toBe(404);
  });

  it("503s quietly when no AI connection is configured", async () => {
    const so = await org("ServiceOwner", "ServiceOwner");
    const res = await ask(so.id, { question: "How does certification start?" });
    expect(res.status).toBe(503);
  });

  it("validates the question", async () => {
    const so = await enableAi();
    expect((await ask(so.id, { question: "x".repeat(501) })).status).toBe(400);
  });
});
