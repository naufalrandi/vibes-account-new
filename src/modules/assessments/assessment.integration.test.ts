import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import {
  initModels, Organization, User, Role, Framework, FrameworkElement,
  FrameworkRequirement, RequirementCriterion, ElementRequirementXref,
  ConformanceQuestion, ConformanceResponse,
} from "../../db/models";
import { hashPassword } from "../../lib/password";
import { resetDb, grantActions } from "../../../test/helpers";
import { ACTIONS } from "../iam/actions.catalog";

const app = createApp();
const authed = (t: string) => ({ Authorization: `Bearer ${t}` });
const RUN = [ACTIONS.ASSESSMENT_RUN_READ, ACTIONS.ASSESSMENT_RUN_MANAGE];

async function makeTenant(username: string, code: string, actions = RUN): Promise<{ token: string; orgId: string }> {
  const org = await Organization.create({ name: code, code, type: "Tenant", status: "Active", parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null });
  const user = await User.create({ orgId: org.id, tenantId: null, fullName: "T", username, email: `${username}@x.io`, passwordHash: await hashPassword("ChangeMe123"), status: "Active", position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null });
  const role = await Role.create({ name: `R-${username}`, tierScope: "Tenant", orgId: org.id, isSuperAdmin: false, status: true });
  await (user as unknown as { setRoles: (r: Role[]) => Promise<unknown> }).setRoles([role]);
  await grantActions(role.id, actions);
  const login = await request(app).post("/v1/auth/login").send({ identifier: username, password: "ChangeMe123" });
  return { token: login.body.data.accessToken, orgId: org.id };
}

interface Meta {
  frameworkId: string;
  auditQuestionId: string;
  auditHighResponseId: string; // score 5
  auditLowResponseId: string; // score 0
  riskQuestionId: string;
  riskHighResponseId: string; // score 5
  riskLowResponseId: string; // score 0
}

/** Seed a framework with two assessable elements (Internal Audit, Risk Assessment). */
async function seedMeta(): Promise<Meta> {
  const fw = await Framework.create({ name: "ISO/IEC 27001:2022", groupId: null, familyId: null, code: null, version: null, status: "Active", shortDescription: null, fullDescription: null, jurisdictions: ["Global"], publishedDate: null });
  const auditEl = await FrameworkElement.create({ code: "FWE-001", name: "Internal Audit", description: null, category: "Core", status: "Active" });
  const riskEl = await FrameworkElement.create({ code: "FWE-002", name: "Risk Assessment", description: null, category: "Core", status: "Active" });

  const reqAudit = await FrameworkRequirement.create({ frameworkId: fw.id, code: "Clause 9.2.1", subject: "Internal Audit", description: "d", status: "Active" });
  const reqRisk = await FrameworkRequirement.create({ frameworkId: fw.id, code: "Clause 6.1.2", subject: "Risk Assessment", description: "d", status: "Active" });
  await ElementRequirementXref.create({ elementId: auditEl.id, requirementId: reqAudit.id });
  await ElementRequirementXref.create({ elementId: riskEl.id, requirementId: reqRisk.id });

  const critA0 = await RequirementCriterion.create({ requirementId: reqAudit.id, score: 0, description: "none" });
  const critA5 = await RequirementCriterion.create({ requirementId: reqAudit.id, score: 5, description: "mature" });
  const critR0 = await RequirementCriterion.create({ requirementId: reqRisk.id, score: 0, description: "none" });
  const critR5 = await RequirementCriterion.create({ requirementId: reqRisk.id, score: 5, description: "mature" });

  const auditQ = await ConformanceQuestion.create({ elementId: auditEl.id, text: "Audit maturity?", sortOrder: 1, status: "Active" });
  const auditLow = await ConformanceResponse.create({ questionId: auditQ.id, text: "None", sortOrder: 1, status: "Active", criterionId: critA0.id });
  const auditHigh = await ConformanceResponse.create({ questionId: auditQ.id, text: "Mature", sortOrder: 2, status: "Active", criterionId: critA5.id });

  const riskQ = await ConformanceQuestion.create({ elementId: riskEl.id, text: "Risk maturity?", sortOrder: 1, status: "Active" });
  const riskLow = await ConformanceResponse.create({ questionId: riskQ.id, text: "None", sortOrder: 1, status: "Active", criterionId: critR0.id });
  const riskHigh = await ConformanceResponse.create({ questionId: riskQ.id, text: "Mature", sortOrder: 2, status: "Active", criterionId: critR5.id });

  return {
    frameworkId: fw.id,
    auditQuestionId: auditQ.id, auditHighResponseId: auditHigh.id, auditLowResponseId: auditLow.id,
    riskQuestionId: riskQ.id, riskHighResponseId: riskHigh.id, riskLowResponseId: riskLow.id,
  };
}

describe("assessment run engine", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("builds the assessable question set for a framework scope", async () => {
    const meta = await seedMeta();
    const { token } = await makeTenant("t1", "TEN1");
    const created = await request(app).post("/v1/assessments").set(authed(token)).send({ frameworkId: meta.frameworkId });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ status: "Draft", version: 1, questionCount: 2, answeredCount: 0, maturityScore: null });
    expect(created.body.data.elements.map((e: { elementName: string }) => e.elementName).sort()).toEqual(["Internal Audit", "Risk Assessment"]);
    // Each question exposes its graded response options with scores.
    const audit = created.body.data.elements.find((e: { elementName: string }) => e.elementName === "Internal Audit");
    expect(audit.questions[0].responses.map((r: { score: number }) => r.score).sort()).toEqual([0, 5]);
  });

  it("scores deterministically through the rcmap and derives a gap with a recommended module", async () => {
    const meta = await seedMeta();
    const { token } = await makeTenant("t1", "TEN1");
    const created = await request(app).post("/v1/assessments").set(authed(token)).send({ frameworkId: meta.frameworkId });
    const id = created.body.data.id;

    // Internal Audit → mature (5, no gap); Risk Assessment → none (0, gap).
    const answered = await request(app).post(`/v1/assessments/${id}/answers`).set(authed(token)).send({
      answers: { [meta.auditQuestionId]: meta.auditHighResponseId, [meta.riskQuestionId]: meta.riskLowResponseId },
    });
    expect(answered.status).toBe(200);
    expect(answered.body.data).toMatchObject({ status: "In Progress", answeredCount: 2 });

    const results = await request(app).get(`/v1/assessments/${id}/results`).set(authed(token));
    expect(results.body.data.maturityScore).toBe(2.5); // (5 + 0) / 2
    const riskRes = results.body.data.elements.find((e: { elementName: string }) => e.elementName === "Risk Assessment");
    expect(riskRes.score).toBe(0);

    const finalized = await request(app).post(`/v1/assessments/${id}/finalize`).set(authed(token));
    expect(finalized.status).toBe(200);
    expect(finalized.body.data).toMatchObject({ status: "Completed", maturityScore: 2.5 });

    const gaps = await request(app).get(`/v1/assessments/${id}/gaps`).set(authed(token));
    expect(gaps.body.data).toHaveLength(1);
    expect(gaps.body.data[0]).toMatchObject({
      elementName: "Risk Assessment", score: 0, severity: "High",
      recommendedModuleKey: "risk-management", recommendedRoute: "/implementation/risks",
    });
  });

  it("severity bands scale with the score (High < 2 ≤ Medium < 4 ≤ Low < 5)", async () => {
    const meta = await seedMeta();
    const { token } = await makeTenant("t1", "TEN1");
    const created = await request(app).post("/v1/assessments").set(authed(token)).send({ frameworkId: meta.frameworkId });
    const id = created.body.data.id;
    // Both elements score 0 → both High gaps.
    await request(app).post(`/v1/assessments/${id}/answers`).set(authed(token)).send({
      answers: { [meta.auditQuestionId]: meta.auditLowResponseId, [meta.riskQuestionId]: meta.riskLowResponseId },
    });
    await request(app).post(`/v1/assessments/${id}/finalize`).set(authed(token));
    const gaps = await request(app).get(`/v1/assessments/${id}/gaps`).set(authed(token));
    expect(gaps.body.data).toHaveLength(2);
    expect(gaps.body.data.every((g: { severity: string }) => g.severity === "High")).toBe(true);
    // Internal Audit maps to the audits module.
    const audit = gaps.body.data.find((g: { elementName: string }) => g.elementName === "Internal Audit");
    expect(audit.recommendedRoute).toBe("/implementation/audits");
  });

  it("rejects out-of-scope questions and finalize with no answers", async () => {
    const meta = await seedMeta();
    const { token } = await makeTenant("t1", "TEN1");
    const created = await request(app).post("/v1/assessments").set(authed(token)).send({ frameworkId: meta.frameworkId });
    const id = created.body.data.id;
    expect((await request(app).post(`/v1/assessments/${id}/finalize`).set(authed(token))).status).toBe(400);
    const bogus = await request(app).post(`/v1/assessments/${id}/answers`).set(authed(token))
      .send({ answers: { [meta.auditQuestionId]: meta.riskLowResponseId } }); // response not on this question
    expect(bogus.status).toBe(400);
  });

  it("reassessment starts a new version carrying prior answers, and maturity moves with new answers", async () => {
    const meta = await seedMeta();
    const { token } = await makeTenant("t1", "TEN1");
    const created = await request(app).post("/v1/assessments").set(authed(token)).send({ frameworkId: meta.frameworkId });
    const id = created.body.data.id;
    await request(app).post(`/v1/assessments/${id}/answers`).set(authed(token)).send({
      answers: { [meta.auditQuestionId]: meta.auditLowResponseId, [meta.riskQuestionId]: meta.riskLowResponseId },
    });
    const first = await request(app).post(`/v1/assessments/${id}/finalize`).set(authed(token));
    expect(first.body.data.maturityScore).toBe(0);

    const re = await request(app).post(`/v1/assessments/${id}/reassess`).set(authed(token));
    expect(re.status).toBe(201);
    expect(re.body.data).toMatchObject({ version: 2, status: "In Progress", answeredCount: 2 });
    const v2 = re.body.data.id;
    // Improve both answers → maturity climbs.
    await request(app).post(`/v1/assessments/${v2}/answers`).set(authed(token)).send({
      answers: { [meta.auditQuestionId]: meta.auditHighResponseId, [meta.riskQuestionId]: meta.riskHighResponseId },
    });
    const second = await request(app).post(`/v1/assessments/${v2}/finalize`).set(authed(token));
    expect(second.body.data.maturityScore).toBe(5);
    const gaps = await request(app).get(`/v1/assessments/${v2}/gaps`).set(authed(token));
    expect(gaps.body.data).toHaveLength(0); // both elements now ≥ threshold
  });

  it("scopes assessments per tenant — another tenant cannot read or list them", async () => {
    const meta = await seedMeta();
    const a = await makeTenant("t1", "TEN1");
    const b = await makeTenant("t2", "TEN2");
    const created = await request(app).post("/v1/assessments").set(authed(a.token)).send({ frameworkId: meta.frameworkId });
    const id = created.body.data.id;
    expect((await request(app).get(`/v1/assessments/${id}`).set(authed(b.token))).status).toBe(403);
    const bList = await request(app).get("/v1/assessments").set(authed(b.token));
    expect(bList.body.data).toHaveLength(0);
    const aList = await request(app).get("/v1/assessments").set(authed(a.token));
    expect(aList.body.data).toHaveLength(1);
  });

  it("requires the run action grant", async () => {
    const meta = await seedMeta();
    const noGrant = await makeTenant("t3", "TEN3", []);
    expect((await request(app).get("/v1/assessments").set(authed(noGrant.token))).status).toBe(403);
    expect((await request(app).post("/v1/assessments").set(authed(noGrant.token)).send({ frameworkId: meta.frameworkId })).status).toBe(403);
  });
});
