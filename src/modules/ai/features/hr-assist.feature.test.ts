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
import { ACTIONS } from "../../iam/actions.catalog";
import { loadFeatures } from "./registry";

const app = createApp();
const reply = (data: unknown) => ({ text: JSON.stringify(data), model: "m-test", provider: "openai", usage: { inputTokens: 1, outputTokens: 1 }, latencyMs: 1 });
const post = (auth: string, path: string, body: object) => request(app).post(path).set("authorization", auth).send(body);
const prompt = (n = 0) => ai.complete.mock.calls[n][0].messages[0].content as string;

beforeAll(async () => {
  initModels();
  await loadFeatures();
});

/** A Service-Provider admin (recruitment is an Enterprise register) with an enabled AI connection. */
async function spAdmin(actions: string[], roleName = "Administrator") {
  const org = await Organization.create({ name: "SP", code: "SP", type: "ServiceOwner", status: "Active", parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null });
  await AiConnection.create({
    orgId: org.id, provider: "openai", baseUrl: "https://llm.test/v1", model: "m-test", enabled: true,
    apiKeyCiphertext: null, apiKeyIv: null, apiKeyTag: null, apiKeyLast4: null,
    lastTestAt: null, lastTestOk: null, lastTestLatencyMs: null, lastTestError: null, updatedBy: null,
  });
  const user = await User.create({ orgId: org.id, tenantId: null, fullName: "HR Admin", username: "hr", email: "hr@x.test", passwordHash: await hashPassword("ChangeMe123"), status: "Active", position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null });
  const role = await Role.create({ name: roleName, tierScope: "ServiceOwner", orgId: org.id, isSuperAdmin: false, status: true });
  await (user as unknown as { setRoles: (r: Role[]) => Promise<unknown> }).setRoles([role]);
  await grantActions(role.id, actions);
  const res = await request(app).post("/v1/auth/login").send({ identifier: "hr", password: "ChangeMe123" });
  return { auth: `Bearer ${res.body.data.accessToken}`, org, user };
}

const REC = "/v1/business/enterprise/ent-recruitment";

// The platform AI connection belongs to the oldest ServiceOwner org, so a
// ServiceOwner left behind by an earlier test file would shadow this one's.
beforeAll(() => resetDb());

describe("hr-assist feature", () => {
  beforeEach(() => { ai.complete.mockReset(); });
  afterEach(() => resetDb());

  it("job-ad drafts from the opening + matched role without saving anything", async () => {
    const { auth } = await spAdmin([ACTIONS.BUSINESS_READ, ACTIONS.BUSINESS_MANAGE, ACTIONS.COMPETENCE_READ, ACTIONS.COMPETENCE_MANAGE]);
    await post(auth, "/v1/competence/roles", { name: "Quality Manager", description: "Owns the QMS.", responsibilities: [{ id: "r1", text: "Lead internal audits", comps: [] }] });
    const opening = await post(auth, REC, { title: "Quality Manager (Jakarta)", status: "Open", data: { entity: "opening", roleName: "quality manager", department: "QA", description: "Contact budi@x.co" } });
    ai.complete.mockResolvedValueOnce(reply({ title: "Quality Manager", summary: "S", responsibilities: ["Lead audits"], requirements: ["ISO 9001"], fullText: "Full" }));

    const res = await post(auth, "/v1/ai/features/hr-assist/job-ad", { openingId: opening.body.data.id, tone: "friendly" });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ title: "Quality Manager", fullText: "Full", benefitsPlaceholder: expect.any(String), generationId: expect.any(String) });
    expect(prompt()).toContain("Lead internal audits");
    expect(prompt()).not.toContain("budi@x.co");
    expect(ai.complete.mock.calls[0][0].system).toContain("friendly");
    expect((await BusinessRecord.findByPk(opening.body.data.id))!.data).not.toHaveProperty("fullText");
  });

  it("candidate-summary sends professional fields only and needs business.read", async () => {
    const { auth } = await spAdmin([ACTIONS.BUSINESS_READ, ACTIONS.BUSINESS_MANAGE]);
    const cand = await post(auth, REC, {
      title: "Siti Rahma", status: "Interview",
      data: {
        entity: "candidate", email: "siti@x.co", phone: "081234567890", notes: "Religion: X", rating: 5,
        education: [{ level: "Bachelor", field: "Industrial Engineering", institution: "ITB", year: "2018" }],
        experience: [{ title: "QA Engineer", org: "Acme", from: "2018", to: "2025" }],
        offer: { amount: "15000000", currency: "IDR" },
      },
    });
    ai.complete.mockResolvedValueOnce(reply({ summary: "Experienced QA engineer.", strengths: ["7 years QA"], gaps: ["No lead audit"], interviewQuestions: ["Describe an audit you led."] }));
    const res = await post(auth, "/v1/ai/features/hr-assist/candidate-summary", { candidateId: cand.body.data.id });
    expect(res.status).toBe(200);
    expect(res.body.data.interviewQuestions).toEqual(["Describe an audit you led."]);
    const p = prompt();
    expect(p).toContain("Industrial Engineering");
    for (const secret of ["Siti", "siti@x.co", "0812", "Religion", "15000000"]) expect(p).not.toContain(secret);
    expect(ai.complete.mock.calls[0][0].system).toMatch(/do not recommend hiring or rejecting/i);
  });

  it("contract-review summarises included clauses, redacts amounts and lists missing standard clauses", async () => {
    const { auth, user } = await spAdmin([ACTIONS.PERSONNEL_CONTRACTDOC_READ, ACTIONS.PERSONNEL_CONTRACTDOC_MANAGE]);
    const doc = await post(auth, `/v1/users/${user.id}/contract-documents`, {
      title: "Employment Agreement",
      clauses: [
        { title: "Remuneration", category: "Pay", body: "Salary Rp 12.000.000 per month.", sourceId: "c1", edited: false, include: true },
        { title: "Old clause", category: "x", body: "removed", sourceId: "c2", edited: false, include: false },
      ],
    });
    expect(doc.status).toBe(201);
    ai.complete.mockResolvedValueOnce(reply({ summary: "Pay terms only.", clauses: [{ title: "Remuneration", plainLanguage: "Paid monthly.", sourceId: "1" }], missing: ["termination", "invented"] }));
    const res = await post(auth, "/v1/ai/features/hr-assist/contract-review", { contractDocId: doc.body.data.id });
    expect(res.status).toBe(200);
    expect(res.body.data.missingStandardClauses).toEqual([{ key: "termination", name: "Termination and notice" }]);
    expect(res.body.data.disclaimer).toMatch(/not legal advice/);
    expect(prompt()).not.toContain("12.000.000");
    expect(prompt()).not.toContain("removed");
    expect(await AiGeneration.count({ where: { feature: "hr-assist", action: "contract-review" } })).toBe(1);
  });

  it("contract-review is refused without the contract-document read action", async () => {
    const { auth } = await spAdmin([ACTIONS.BUSINESS_READ]);
    const res = await post(auth, "/v1/ai/features/hr-assist/contract-review", { contractDocId: "00000000-0000-4000-8000-000000000000" });
    expect(res.status).toBe(403);
    expect(ai.complete).not.toHaveBeenCalled();
  });

  it("contract-review keeps the Organization Management tier gate of the contract-document routes", async () => {
    const { auth } = await spAdmin([ACTIONS.PERSONNEL_CONTRACTDOC_READ], "Basic User");
    const res = await post(auth, "/v1/ai/features/hr-assist/contract-review", { contractDocId: "00000000-0000-4000-8000-000000000000" });
    expect(res.status).toBe(403);
    expect(ai.complete).not.toHaveBeenCalled();
  });
});
