import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

const ai = vi.hoisted(() => ({ complete: vi.fn() }));
vi.mock("../../../lib/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/ai")>()),
  aiComplete: ai.complete,
}));

import { createApp } from "../../../app";
import { initModels, AiConnection, AiGeneration, BusinessRecord, Organization, Role, User } from "../../../db/models";
import { hashPassword } from "../../../lib/password";
import { grantActions, resetDb } from "../../../../test/helpers";
import { loadFeatures } from "./registry";

const app = createApp();
const reply = (obj: unknown) => ({ text: JSON.stringify(obj), model: "m-test", provider: "openai", usage: { inputTokens: 5, outputTokens: 5 }, latencyMs: 1 });

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

async function login(type: "ServiceOwner" | "Tenant", username: string, opts: { superAdmin?: boolean; actions?: string[]; orgCode?: string } = {}) {
  const o = await org(type, opts.orgCode ?? type);
  const user = await User.create({
    orgId: o.id, tenantId: type === "Tenant" ? o.id : null, fullName: username, username, email: `${username}@x.test`,
    passwordHash: await hashPassword("ChangeMe123"), status: "Active", position: null, workUnit: null, lastLogin: null,
    activationToken: null, resetToken: null, resetExpires: null,
  });
  const role = await Role.create({ name: `R-${username}`, tierScope: type, orgId: o.id, isSuperAdmin: opts.superAdmin ?? false, status: true });
  await (user as unknown as { setRoles: (r: Role[]) => Promise<unknown> }).setRoles([role]);
  if (opts.actions?.length) await grantActions(role.id, opts.actions);
  const res = await request(app).post("/v1/auth/login").send({ identifier: username, password: "ChangeMe123" });
  return { auth: `Bearer ${res.body.data.accessToken}`, orgId: o.id, userId: user.id };
}

const post = (auth: string, path: string, body: object = {}) => request(app).post(path).set("authorization", auth).send(body);

async function enableAi() {
  const so = await org("ServiceOwner", "ServiceOwner");
  await AiConnection.create({
    orgId: so.id, provider: "openai", baseUrl: "https://llm.test/v1", model: "m-test", enabled: true,
    apiKeyCiphertext: null, apiKeyIv: null, apiKeyTag: null, apiKeyLast4: null,
    lastTestAt: null, lastTestOk: null, lastTestLatencyMs: null, lastTestError: null, updatedBy: null,
  });
}

const BIZ = ["business.read", "business.manage"];
let seq = 0;
async function rec(orgId: string, module: string, title: string, data: Record<string, unknown>, company = "axia") {
  seq += 1;
  return BusinessRecord.create({ orgId, area: "enterprise", module, code: `T-${seq}`, title, status: "Open", owner: null, company, data });
}

const promptOf = (call = 0) => (ai.complete.mock.calls[call][0] as { messages: { content: string }[] }).messages[0].content;
const URL = "/v1/ai/features/sales-assist";

// The platform AI connection belongs to the oldest ServiceOwner org, so a
// ServiceOwner left behind by an earlier test file would shadow this one's.
beforeAll(() => resetDb());

describe("sales-assist feature", () => {
  beforeEach(() => { ai.complete.mockReset(); });
  afterEach(() => resetDb());

  it("qualify-lead: clamps the score, validates the service and redacts contact details", async () => {
    await enableAi();
    const { auth, orgId } = await login("Tenant", "s1", { actions: BIZ });
    const lead = await rec(orgId, "ent-leads", "PT Sinar Jaya", { email: "budi@sinar.co.id", industry: "Manufacturing", activity: [{ action: "x" }] });
    ai.complete.mockResolvedValueOnce(reply({
      summary: "Manufacturer seeking ISO 9001.", fitScore: 140, reasons: ["Clear need"], suggestedService: "impl",
      suggestedVariant: "Nope", missingInfo: ["Headcount"], suggestedNextStep: "Book a discovery call",
    }));
    const res = await post(auth, `${URL}/qualify-lead`, { leadId: lead.id });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      recordType: "lead", fitScore: 100, missingInfo: ["Headcount"],
      suggestedService: { id: "impl", name: "Framework Implementation", variant: "Full Consultancy" },
    });
    expect(promptOf()).toContain("[redacted]");
    expect(promptOf()).not.toContain("budi@sinar.co.id");
    const gen = await AiGeneration.findByPk(res.body.data.generationId);
    expect(gen).toMatchObject({ feature: "sales-assist", action: "qualify-lead", targetType: "ent-leads", targetId: lead.id });
  });

  it("qualify-lead: accepts an inquiry id, drops an unknown service, and 404s on another org's record", async () => {
    await enableAi();
    const { auth, orgId } = await login("Tenant", "s2", { actions: BIZ });
    const inq = await rec(orgId, "ent-inq", "Inquiry", { service: "audit", notes: "Supplier audit" });
    ai.complete.mockResolvedValueOnce(reply({ summary: "x", fitScore: 50, reasons: [], suggestedService: "cert", missingInfo: [], suggestedNextStep: "Call" }));
    const res = await post(auth, `${URL}/qualify-lead`, { leadId: inq.id });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ recordType: "inquiry", suggestedService: null });

    const other = await login("Tenant", "s3", { actions: BIZ, orgCode: "OTHER" });
    const foreign = await rec(other.orgId, "ent-leads", "Foreign", {});
    expect((await post(auth, `${URL}/qualify-lead`, { leadId: foreign.id })).status).toBe(404);
  });

  it("inquiry-scope: suggests only open questionnaire keys of the inquiry's service", async () => {
    await enableAi();
    const { auth, orgId } = await login("Tenant", "s4", { actions: BIZ });
    const inq = await rec(orgId, "ent-inq", "ISO 9001", { service: "impl", variant: "Full Consultancy", sq: { sites: "3" }, notes: "3 plants, 450 staff" });
    ai.complete.mockResolvedValueOnce(reply({
      scopeText: "Implement ISO 9001 across 3 plants.",
      answers: [{ key: "sites", value: "5" }, { key: "headcount", value: "450" }, { key: "budget", value: "1bn" }],
    }));
    const res = await post(auth, `${URL}/inquiry-scope`, { inquiryId: inq.id });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ scopeText: "Implement ISO 9001 across 3 plants.", suggestedAnswers: { headcount: "450" } });
    expect(res.body.data.suggestedAnswers).not.toHaveProperty("sites");
    expect(res.body.data.suggestedAnswers).not.toHaveProperty("budget");
    const stored = await BusinessRecord.findByPk(inq.id);
    expect(stored!.data).toMatchObject({ sq: { sites: "3" } }); // nothing written
  });

  it("proposal-draft: returns content without prices and keeps only clause ids from the library", async () => {
    await enableAi();
    const { auth, orgId } = await login("Tenant", "s5", { actions: BIZ });
    const inq = await rec(orgId, "ent-inq", "ISO 27001", { service: "impl", sq: { sites: "2" } });
    const clause = await rec(orgId, "ent-clauses", "Scope of Services", { category: "General", domain: "Service", body: "<p>Scope</p>" });
    await rec(orgId, "ent-clauses", "Working Hours", { domain: "Employment", body: "hours" });
    ai.complete.mockResolvedValueOnce(reply({
      items: [{ description: "ISO 27001 implementation", qty: 2.4, unit: "site", suggestedServiceKey: "impl", price: 999 }, { description: "Gap", qty: -1, unit: "lot", suggestedServiceKey: "zzz" }],
      notes: "Two sites.",
      termSuggestions: [{ termId: clause.id, reason: "Defines scope" }, { termId: "cl-made-up", reason: "x" }],
    }));
    const res = await post(auth, `${URL}/proposal-draft`, { inquiryId: inq.id });
    expect(res.status).toBe(200);
    expect(res.body.data.items).toEqual([
      { description: "ISO 27001 implementation", qty: 2, unit: "site", suggestedServiceKey: "impl" },
      { description: "Gap", qty: 1, unit: "lot", suggestedServiceKey: null },
    ]);
    expect(res.body.data.termSuggestions).toEqual([{ termId: clause.id, reason: "Defines scope" }]);
    expect(promptOf()).not.toContain("Working Hours");
    expect((await post(auth, `${URL}/proposal-draft`, {})).status).toBe(400);
  });

  it("contract-clauses: validates the contract type and clause ids", async () => {
    await enableAi();
    const { auth, orgId } = await login("Tenant", "s6", { actions: BIZ });
    const clause = await rec(orgId, "ent-clauses", "Fees", { domain: "Service", body: "Fees" });
    const type = await rec(orgId, "ent-svc-ctypes", "Consultancy Agreement", { domain: "Service", defaultTerms: [clause.id] });
    const prop = await rec(orgId, "ent-proposals", "Proposal", { service: "impl", items: [{ desc: "Impl", qty: 1, unit: 100 }] });
    ai.complete.mockResolvedValueOnce(reply({
      contractTypeId: type.id, contractTypeReason: "Implementation work",
      clauses: [{ clauseId: clause.id, reason: "Payment" }, { clauseId: "nope", reason: "x" }],
    }));
    const res = await post(auth, `${URL}/contract-clauses`, { proposalId: prop.id });
    expect(res.status).toBe(200);
    expect(res.body.data.contractType).toEqual({ id: type.id, title: "Consultancy Agreement", reason: "Implementation work" });
    expect(res.body.data.clauses).toEqual([{ clauseId: clause.id, reason: "Payment", title: "Fees" }]);
  });

  it("requires a business permission", async () => {
    await enableAi();
    const { auth, orgId } = await login("Tenant", "s7", { actions: [] });
    const lead = await rec(orgId, "ent-leads", "Lead", {});
    expect((await post(auth, `${URL}/qualify-lead`, { leadId: lead.id })).status).toBe(403);
    expect(ai.complete).not.toHaveBeenCalled();
  });
});
