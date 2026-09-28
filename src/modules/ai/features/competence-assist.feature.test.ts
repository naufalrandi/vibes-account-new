import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

const ai = vi.hoisted(() => ({ complete: vi.fn() }));
vi.mock("../../../lib/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/ai")>()),
  aiComplete: ai.complete,
}));

import { createApp } from "../../../app";
import { initModels, AiConnection, CompetenceExamAttempt, Organization, Role, User } from "../../../db/models";
import { hashPassword } from "../../../lib/password";
import { grantActions, resetDb } from "../../../../test/helpers";
import { ACTIONS } from "../../iam/actions.catalog";
import { loadFeatures } from "./registry";
import { processOneJob } from "./jobs";

const app = createApp();
const reply = (data: unknown) => ({ text: JSON.stringify(data), model: "m-test", provider: "openai", usage: { inputTokens: 1, outputTokens: 1 }, latencyMs: 1 });
const post = (auth: string, path: string, body: object) => request(app).post(path).set("authorization", auth).send(body);
const prompt = (n = 0) => ai.complete.mock.calls[n][0].messages[0].content as string;
const F = "/v1/ai/features/competence-assist";

beforeAll(async () => {
  initModels();
  await loadFeatures();
});

async function org(type: "ServiceOwner" | "Tenant", code: string) {
  const o = await Organization.create({ name: code, code, type, status: "Active", parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null });
  return type === "Tenant" ? o.update({ tenantId: o.id }) : o;
}

async function login(username: string, actions: string[]) {
  const o = await org("Tenant", `T-${username}`);
  const user = await User.create({ orgId: o.id, tenantId: o.id, fullName: username, username, email: `${username}@x.test`, passwordHash: await hashPassword("ChangeMe123"), status: "Active", position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null });
  const role = await Role.create({ name: `R-${username}`, tierScope: "Tenant", orgId: o.id, isSuperAdmin: false, status: true });
  await (user as unknown as { setRoles: (r: Role[]) => Promise<unknown> }).setRoles([role]);
  await grantActions(role.id, actions);
  const res = await request(app).post("/v1/auth/login").send({ identifier: username, password: "ChangeMe123" });
  return { auth: `Bearer ${res.body.data.accessToken}`, orgId: o.id, userId: user.id };
}

async function enableAi() {
  const so = await org("ServiceOwner", "SO");
  await AiConnection.create({
    orgId: so.id, provider: "openai", baseUrl: "https://llm.test/v1", model: "m-test", enabled: true,
    apiKeyCiphertext: null, apiKeyIv: null, apiKeyTag: null, apiKeyLast4: null,
    lastTestAt: null, lastTestOk: null, lastTestLatencyMs: null, lastTestError: null, updatedBy: null,
  });
}

const COMP = [ACTIONS.COMPETENCE_READ, ACTIONS.COMPETENCE_MANAGE];
const single = (q: string) => ({ type: "single", question: q, options: [{ text: "Yes", correct: true }, { text: "No", correct: false }], ref: "ISO 19011:2018" });

// The platform AI connection belongs to the oldest ServiceOwner org, so a
// ServiceOwner left behind by an earlier test file would shadow this one's.
beforeAll(() => resetDb());

describe("competence-assist feature", () => {
  beforeEach(() => { ai.complete.mockReset(); });
  afterEach(() => resetDb());

  it("role-draft returns only new lines, library skill names and known codes", async () => {
    await enableAi();
    const { auth } = await login("comp", COMP);
    ai.complete.mockResolvedValueOnce(reply({
      description: "Owns the QMS.",
      responsibilities: ["Plan the internal audit programme.", "Existing duty."],
      authorities: ["Approve quality procedures."],
      skills: [{ name: "internal auditing", level: 3 }],
      eduFields: ["0413", "nope"],
      expReqs: [{ sector: "C", years: 3 }],
    }));
    const res = await post(auth, `${F}/role-draft`, { roleName: "QA Manager", currentDraft: { responsibilities: ["existing duty."] } });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      responsibilities: ["Plan the internal audit programme."],
      skills: [{ name: "Internal Auditing", level: 3, inLibrary: true }],
      eduFields: [{ code: "0413", label: expect.any(String) }],
      expReqs: [{ sector: "C", years: "3", label: "Manufacturing" }],
      examples: expect.arrayContaining(["Quality Manager"]),
      generationId: expect.any(String),
    });
    expect(prompt()).toContain("Quality Manager");
  });

  it("role-draft refuses a caller without competence.manage", async () => {
    await enableAi();
    const { auth } = await login("reader", [ACTIONS.COMPETENCE_READ]);
    expect((await post(auth, `${F}/role-draft`, { roleName: "Auditor" })).status).toBe(403);
  });

  it("exam-items drafts instrument questions with few-shot bank examples; bulk runs as a job", async () => {
    await enableAi();
    const { auth } = await login("exam", COMP);
    ai.complete.mockResolvedValueOnce(reply({ items: [single("What is audit evidence?"), { type: "short", question: "Wrong type", modelAnswer: "x" }] }));
    const res = await post(auth, `${F}/exam-items`, { skill: "Internal Auditing", level: 1, count: 2, type: "mcq", existing: [] });
    expect(res.status).toBe(200);
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.items[0]).toMatchObject({ type: "single", text: "What is audit evidence?", points: 1, ref: "ISO 19011:2018" });
    expect(res.body.data.generationIds).toHaveLength(1);
    expect(prompt()).toContain("ISO 19011"); // few-shot from the bank

    ai.complete.mockResolvedValueOnce(reply({ items: Array.from({ length: 10 }, (_, i) => single(`Q${i}?`)) }));
    ai.complete.mockResolvedValueOnce(reply({ items: [single("Q10?"), single("Q11?")] }));
    const job = await post(auth, `${F}/exam-items-bulk`, { skill: "Internal Auditing", level: 2, count: 12, type: "mcq" });
    expect(job.status).toBe(202);
    await processOneJob();
    const done = await request(app).get(`/v1/ai/jobs/${job.body.data.jobId}`).set("authorization", auth);
    expect(done.body.data.status).toBe("done");
    expect(done.body.data.result.items).toHaveLength(12);
    expect(done.body.data.result.generationIds).toHaveLength(2);
  });

  it("grade-short-answers suggests clamped scores and leaves the attempt pending", async () => {
    await enableAi();
    const { auth, userId } = await login("grader", COMP);
    const skill = await post(auth, "/v1/competence/skills", { name: "Report Writing", type: "hard" });
    const exam = await post(auth, "/v1/competence/instruments/exams", {
      skillId: skill.body.data.id, level: 1,
      questions: [{ id: "q1", type: "short", text: "Why write findings factually?", points: 2, model: "So they can be verified." }],
    });
    const attempt = await post(auth, `/v1/competence/instruments/exams/${exam.body.data.id}/take`, { personId: userId, answers: { q1: "Because auditors must verify them; email me at a@b.co" } });
    expect(attempt.body.data.status).toBe("PendingGrading");

    ai.complete.mockResolvedValueOnce(reply({ grades: [{ questionId: "q1", suggestedScore: 5, rationale: "Matches the model answer." }, { questionId: "zz", suggestedScore: 1, rationale: "" }] }));
    const res = await post(auth, `${F}/grade-short-answers`, { attemptId: attempt.body.data.id });
    expect(res.status).toBe(200);
    expect(res.body.data.suggestions).toEqual([{ questionId: "q1", suggestedScore: 2, maxScore: 2, rationale: "Matches the model answer." }]);
    expect(prompt()).toContain("So they can be verified.");
    expect(prompt()).not.toContain("a@b.co");
    const row = await CompetenceExamAttempt.findByPk(attempt.body.data.id);
    expect(row).toMatchObject({ status: "PendingGrading", grades: {} });
  });

  it("awareness-quiz builds quiz questions from a topic", async () => {
    await enableAi();
    const { auth } = await login("aw", [ACTIONS.MS_READ, ACTIONS.MS_MANAGE]);
    const topic = await post(auth, "/v1/implementation/awareness-topics", { title: "Phishing", data: { summary: "Spot and report phishing.", keyMessages: "Report to IT within 1 hour." } });
    ai.complete.mockResolvedValueOnce(reply({ items: [
      { type: "single", question: "Who do you report phishing to?", options: [{ text: "IT", correct: true }, { text: "Nobody", correct: false }] },
      { type: "truefalse", question: "You may click unknown links.", answerTrue: false },
    ] }));
    const res = await post(auth, `${F}/awareness-quiz`, { topicId: topic.body.data.id, count: 2 });
    expect(res.status).toBe(200);
    expect(res.body.data.questions.map((q: { type: string }) => q.type)).toEqual(["single", "truefalse"]);
    expect(prompt()).toContain("Report to IT within 1 hour.");
  });
});
