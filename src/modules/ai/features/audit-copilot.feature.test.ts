import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

const ai = vi.hoisted(() => ({ complete: vi.fn() }));
vi.mock("../../../lib/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/ai")>()),
  aiComplete: ai.complete,
}));

import { createApp } from "../../../app";
import { initModels, AiConnection, IaReport, Organization, Role, User } from "../../../db/models";
import { hashPassword } from "../../../lib/password";
import { grantActions, resetDb } from "../../../../test/helpers";
import { ACTIONS } from "../../iam/actions.catalog";
import { loadFeatures } from "./registry";

const app = createApp();
const reply = (o: unknown) => ({ text: JSON.stringify(o), model: "m-test", provider: "openai", usage: { inputTokens: 5, outputTokens: 5 }, latencyMs: 1 });
const authed = (t: string) => ({ authorization: `Bearer ${t}` });
const IA = [ACTIONS.IAUDIT_READ, ACTIONS.IAUDIT_MANAGE, ACTIONS.MS_READ, ACTIONS.MS_MANAGE];

async function org(type: "ServiceOwner" | "Tenant", code: string) {
  const o = await Organization.create({ name: code, code, type, status: "Active", parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null });
  return type === "Tenant" ? o.update({ tenantId: o.id }) : o;
}

async function login(username: string, code: string, actions: string[]) {
  const o = await org("Tenant", code);
  const user = await User.create({
    orgId: o.id, tenantId: o.id, fullName: username, username, email: `${username}@x.test`,
    passwordHash: await hashPassword("ChangeMe123"), status: "Active", position: null, workUnit: null, lastLogin: null,
    activationToken: null, resetToken: null, resetExpires: null,
  });
  const role = await Role.create({ name: `R-${username}`, tierScope: "Tenant", orgId: o.id, isSuperAdmin: false, status: true });
  await (user as unknown as { setRoles: (r: Role[]) => Promise<unknown> }).setRoles([role]);
  if (actions.length) await grantActions(role.id, actions);
  const res = await request(app).post("/v1/auth/login").send({ identifier: username, password: "ChangeMe123" });
  return res.body.data.accessToken as string;
}

async function enableAi() {
  const so = await org("ServiceOwner", "ServiceOwner");
  await AiConnection.create({
    orgId: so.id, provider: "openai", baseUrl: "https://llm.test/v1", model: "m-test", enabled: true,
    apiKeyCiphertext: null, apiKeyIv: null, apiKeyTag: null, apiKeyLast4: null,
    lastTestAt: null, lastTestOk: null, lastTestLatencyMs: null, lastTestError: null, updatedBy: null,
  });
}

async function seedProgram(token: string) {
  const prog = await request(app).post("/v1/internal-audit/programs").set(authed(token)).send({
    name: "2026 Programme", period: "2026-06", processes: ["Purchasing"], criteria: ["ISO 9001:2015"], leadAuditor: "Lead", auditors: ["Aud"],
  });
  const programId = prog.body.data.id;
  await request(app).post(`/v1/internal-audit/programs/${programId}/status`).set(authed(token)).send({ status: "Approved" });
  const plan = await request(app).post("/v1/internal-audit/plans").set(authed(token)).send({ programId, name: "Plan" });
  const session = await request(app).post("/v1/internal-audit/sessions").set(authed(token)).send({
    planId: plan.body.data.id, title: "Purchasing audit", date: "2026-06-15", start: "09:00", end: "12:00", process: "Purchasing", auditor: "Aud",
  });
  return { programId, sessionId: session.body.data.id as string };
}

// The platform AI connection belongs to the oldest ServiceOwner org, so a
// ServiceOwner left behind by an earlier test file would shadow this one's.
beforeAll(() => resetDb());

describe("audit-copilot feature", () => {
  beforeAll(async () => {
    initModels();
    await loadFeatures();
  });
  beforeEach(() => { ai.complete.mockReset(); });
  afterEach(() => resetDb());

  it("checklist maps unknown clause refs to General", async () => {
    await enableAi();
    const token = await login("ac1", "AC1", IA);
    const { sessionId } = await seedProgram(token);
    ai.complete.mockResolvedValueOnce(reply({ items: [{ clauseRef: "8.4", question: "How are suppliers evaluated?", evidenceToSeek: "Evaluation records" }] }));
    const res = await request(app).post("/v1/ai/features/audit-copilot/checklist").set(authed(token)).send({ sessionId });
    expect(res.status).toBe(200);
    expect(res.body.data.items).toEqual([{ clauseRef: "General", question: "How are suppliers evaluated?", evidenceToSeek: "Evaluation records" }]);
    expect(res.body.data.generationId).toEqual(expect.any(String));
  });

  it("finding-from-notes returns a suggestion only and drops an invalid type", async () => {
    await enableAi();
    const token = await login("ac2", "AC2", IA);
    const { sessionId } = await seedProgram(token);
    ai.complete.mockResolvedValueOnce(reply({
      title: "Supplier not evaluated", type: "Major NC", description: "d", evidence: "PO-12 sampled", criteria: "8.4", clauseRefs: ["8.4"], suggestedSeverityRationale: "r",
    }));
    const res = await request(app).post("/v1/ai/features/audit-copilot/finding-from-notes").set(authed(token)).send({ sessionId, notes: "PO-12 supplier had no evaluation" });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ title: "Supplier not evaluated", type: null, clauseRefs: [], process: "Purchasing" });
    expect((await request(app).get("/v1/internal-audit/findings").set(authed(token))).body.data).toHaveLength(0);
  });

  it("report drafts from the programme's actual findings without saving", async () => {
    await enableAi();
    const token = await login("ac3", "AC3", IA);
    const { programId, sessionId } = await seedProgram(token);
    await request(app).post("/v1/internal-audit/findings").set(authed(token)).send({ programId, sessionId, title: "No supplier evaluation", description: "d", evidence: "e", process: "Purchasing", type: "Nonconformity" });
    const rep = await request(app).post("/v1/internal-audit/reports").set(authed(token)).send({ programId });
    ai.complete.mockResolvedValueOnce(reply({ summary: "1 session, 1 NC [IAF-0001].", conclusion: "Partially effective.", strengths: [], improvementAreas: ["Supplier evaluation"] }));
    const res = await request(app).post("/v1/ai/features/audit-copilot/report").set(authed(token)).send({ reportId: rep.body.data.id });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ conclusion: "Partially effective.", findingsCount: 1, sessionsCount: 1 });
    const prompt = ai.complete.mock.calls[0][0].messages[0].content as string;
    expect(prompt).toContain("[IAF-0001] Nonconformity: No supplier evaluation");
    expect((await IaReport.findByPk(rep.body.data.id))!.conclusion).toMatch(/effectively implemented/);
  });

  it("is org-scoped", async () => {
    await enableAi();
    const a = await login("ac4", "AC4", IA);
    const { sessionId } = await seedProgram(a);
    const b = await login("ac5", "AC5", IA);
    expect((await request(app).post("/v1/ai/features/audit-copilot/checklist").set(authed(b)).send({ sessionId })).status).toBe(404);
    expect(ai.complete).not.toHaveBeenCalled();
  });
});
