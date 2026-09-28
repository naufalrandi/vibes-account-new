import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

const ai = vi.hoisted(() => ({ complete: vi.fn() }));
vi.mock("../../../lib/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/ai")>()),
  aiComplete: ai.complete,
}));

import { createApp } from "../../../app";
import {
  initModels, AiConnection, AiGeneration, ConformanceQuestion, ConformanceResponse, Framework, FrameworkElement,
  FrameworkRequirement, Fwrc, ImplementationRecord, Organization, Role, User,
} from "../../../db/models";
import { hashPassword } from "../../../lib/password";
import { grantActions, resetDb } from "../../../../test/helpers";
import { ACTIONS } from "../../iam/actions.catalog";
import { loadFeatures } from "./registry";
import { processOneJob } from "./jobs";

const app = createApp();
const reply = (text: string) => ({ text, model: "m-test", provider: "openai", usage: { inputTokens: 1, outputTokens: 1 }, latencyMs: 1 });
const post = (auth: string, path: string, body: object) => request(app).post(path).set("authorization", auth).send(body);
const get = (auth: string, path: string) => request(app).get(path).set("authorization", auth);

beforeAll(async () => {
  initModels();
  await loadFeatures();
});

async function org(type: "ServiceOwner" | "Tenant", code: string) {
  const o = await Organization.create({
    name: code, code, type, status: "Active", parentOrgId: null, tenantId: null,
    email: null, phone: null, website: null, country: null, address: null,
  });
  return type === "Tenant" ? o.update({ tenantId: o.id }) : o;
}

async function login(username: string, orgCode: string, actions: string[]) {
  const o = (await Organization.findOne({ where: { code: orgCode } })) ?? (await org("Tenant", orgCode));
  const user = await User.create({
    orgId: o.id, tenantId: o.id, fullName: username, username, email: `${username}@x.test`,
    passwordHash: await hashPassword("ChangeMe123"), status: "Active", position: null, workUnit: null, lastLogin: null,
    activationToken: null, resetToken: null, resetExpires: null,
  });
  const role = await Role.create({ name: `R-${username}`, tierScope: "Tenant", orgId: o.id, isSuperAdmin: false, status: true });
  await (user as unknown as { setRoles: (r: Role[]) => Promise<unknown> }).setRoles([role]);
  await grantActions(role.id, actions);
  const res = await request(app).post("/v1/auth/login").send({ identifier: username, password: "ChangeMe123" });
  return { auth: `Bearer ${res.body.data.accessToken}`, orgId: o.id };
}

async function enableAi() {
  const so = await org("ServiceOwner", "SO");
  await AiConnection.create({
    orgId: so.id, provider: "openai", baseUrl: "https://llm.test/v1", model: "m-test", enabled: true,
    apiKeyCiphertext: null, apiKeyIv: null, apiKeyTag: null, apiKeyLast4: null,
    lastTestAt: null, lastTestOk: null, lastTestLatencyMs: null, lastTestError: null, updatedBy: null,
  });
}

/** One framework, one element, one question (None=0 / Partial / Full=9 ordinal ladder) mapped to clause 9.2 via FWRC. */
async function seed() {
  const fw = await Framework.create({ name: "ISO 9001:2015", groupId: null, familyId: null, code: "ISO9001", version: null, status: "Active", shortDescription: null, fullDescription: null, jurisdictions: ["Global"], publishedDate: null });
  const el = await FrameworkElement.create({ code: "FWE-010", name: "Internal Audit", description: null, category: "Core", status: "Active" });
  const req = await FrameworkRequirement.create({ frameworkId: fw.id, code: "9.2", subject: "Internal audit", description: "d", status: "Active" });
  const q = await ConformanceQuestion.create({ elementId: el.id, text: "Is an audit programme in place?", sortOrder: 1, status: "Active" });
  const none = await ConformanceResponse.create({ questionId: q.id, text: "No programme", sortOrder: 1, status: "Active", criterionId: null });
  const full = await ConformanceResponse.create({ questionId: q.id, text: "Full programme", sortOrder: 2, status: "Active", criterionId: null });
  const f1 = await Fwrc.create({ code: "FWRC-0001", frameworkId: fw.id, requirementId: req.id, elementId: el.id, questionId: q.id, responseId: none.id, statement: "No audits are planned." });
  await Fwrc.create({ code: "FWRC-0002", frameworkId: fw.id, requirementId: req.id, elementId: el.id, questionId: q.id, responseId: full.id, statement: "Audits are planned." });
  return { fw, q, none, fwrcId: f1.id };
}

const MODEL_OUT = {
  executiveSummary: "Not ready yet.",
  clauses: [{ requirementCode: "9.2", finding: "No audit programme [x].", recommendation: "Plan audits." }],
  roadmap: [
    { phase: "30 days", actions: [{ title: "Write audit procedure", clauseRefs: ["9.2", "99.9"], ownerRole: "QA Manager", module: "policies" }] },
    { phase: "60 days", actions: [{ title: "Run first audit", clauseRefs: ["9.2"], ownerRole: "Auditor", module: "improvements" }] },
  ],
};

// The platform AI connection belongs to the oldest ServiceOwner org, so a
// ServiceOwner left behind by an earlier test file would shadow this one's.
beforeAll(() => resetDb());

describe("gap-report feature", () => {
  beforeEach(() => { ai.complete.mockReset(); });
  afterEach(() => resetDb());

  it("generates a report as a job with computed readiness and severity, then creates only the selected drafts", async () => {
    await enableAi();
    const { fw, q, none, fwrcId } = await seed();
    const { auth, orgId } = await login("t1", "TEN1", [ACTIONS.ASSESSMENT_RUN_READ, ACTIONS.ASSESSMENT_RUN_MANAGE, ACTIONS.MS_MANAGE]);
    const created = await post(auth, "/v1/assessments", { frameworkId: fw.id });
    const id = created.body.data.id as string;

    // Not finalized yet → refused before any model call.
    const early = await post(auth, "/v1/ai/features/gap-report/generate", { assessmentId: id });
    expect(early.status).toBe(202);
    await processOneJob();
    const earlyJob = await get(auth, `/v1/ai/jobs/${early.body.data.jobId}`);
    expect(earlyJob.body.data.status).toBe("failed");
    expect(ai.complete).not.toHaveBeenCalled();

    await post(auth, `/v1/assessments/${id}/answers`, { answers: { [q.id]: none.id } });
    await post(auth, `/v1/assessments/${id}/finalize`, {});

    ai.complete.mockResolvedValueOnce(reply(JSON.stringify(MODEL_OUT)));
    const started = await post(auth, "/v1/ai/features/gap-report/generate", { assessmentId: id });
    expect(started.status).toBe(202);
    await processOneJob();
    const job = await get(auth, `/v1/ai/jobs/${started.body.data.jobId}`);
    expect(job.body.data.status).toBe("done");
    const report = job.body.data.result;
    expect(report.overallReadiness).toBe(0); // maturity 0/9, fully answered
    expect(report.clauses).toEqual([expect.objectContaining({
      requirementCode: "9.2", severity: "High", finding: "No audit programme [x].",
      evidenceSources: expect.arrayContaining([q.id, fwrcId]),
    })]);
    expect(report.roadmap.map((p: { phase: string }) => p.phase)).toEqual(["30 days", "60 days", "90 days"]);
    expect(report.roadmap[0].actions[0].clauseRefs).toEqual(["9.2"]); // invented ref dropped
    expect(ai.complete.mock.calls[0][0].messages[0].content).toContain("Clause 9.2 — Internal audit");

    const gen = await AiGeneration.findByPk(report.generationId);
    expect(gen?.targetId).toBe(id);

    const drafts = await post(auth, "/v1/ai/features/gap-report/create-drafts", {
      assessmentId: id, generationId: report.generationId,
      actions: [{ title: "Write audit procedure", module: "policies", clauseRefs: ["9.2"] }],
    });
    expect(drafts.status).toBe(200);
    expect(drafts.body.data.created).toHaveLength(1);
    const rec = await ImplementationRecord.findByPk(drafts.body.data.created[0].id);
    expect(rec).toMatchObject({ orgId, module: "policies", status: "Draft", title: "Write audit procedure" });
    expect(ai.complete).toHaveBeenCalledTimes(1);
  });

  it("scopes to the caller's org and requires manage rights for drafts", async () => {
    await enableAi();
    const { fw } = await seed();
    const owner = await login("t1", "TEN1", [ACTIONS.ASSESSMENT_RUN_READ, ACTIONS.ASSESSMENT_RUN_MANAGE]);
    const id = (await post(owner.auth, "/v1/assessments", { frameworkId: fw.id })).body.data.id as string;

    const other = await login("t2", "TEN2", [ACTIONS.ASSESSMENT_RUN_READ, ACTIONS.ASSESSMENT_RUN_MANAGE, ACTIONS.MS_MANAGE]);
    const res = await post(other.auth, "/v1/ai/features/gap-report/create-drafts", {
      assessmentId: id, generationId: "00000000-0000-4000-8000-000000000000",
      actions: [{ title: "x", module: "policies", clauseRefs: [] }],
    });
    expect([403, 404]).toContain(res.status);

    const noMs = await post(owner.auth, "/v1/ai/features/gap-report/create-drafts", {
      assessmentId: id, generationId: "00000000-0000-4000-8000-000000000000",
      actions: [{ title: "x", module: "policies", clauseRefs: [] }],
    });
    expect(noMs.status).toBe(403);
    expect(ai.complete).not.toHaveBeenCalled();
  });
});
