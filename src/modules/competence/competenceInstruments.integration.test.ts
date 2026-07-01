import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import { initModels, Organization, User, Role } from "../../db/models";
import { hashPassword } from "../../lib/password";
import { resetDb, grantActions } from "../../../test/helpers";
import { ACTIONS } from "../iam/actions.catalog";

const app = createApp();
const authed = (t: string) => ({ Authorization: `Bearer ${t}` });
const CO = [ACTIONS.COMPETENCE_READ, ACTIONS.COMPETENCE_MANAGE];
const PERSON = "22222222-2222-2222-2222-222222222222";

async function makeTenant(username: string, code: string, actions: string[] = CO): Promise<{ token: string; orgId: string }> {
  const org = await Organization.create({ name: code, code, type: "Tenant", status: "Active", parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null });
  await User.create({ orgId: org.id, tenantId: null, fullName: "Assessor", username, email: `${username}@x.io`, passwordHash: await hashPassword("ChangeMe123"), status: "Active", position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null });
  const role = await Role.create({ name: `R-${username}`, tierScope: "Tenant", orgId: org.id, isSuperAdmin: false, status: true });
  const u = await User.findOne({ where: { username } });
  await (u as unknown as { setRoles: (r: Role[]) => Promise<unknown> }).setRoles([role]);
  await grantActions(role.id, actions);
  const login = await request(app).post("/v1/auth/login").send({ identifier: username, password: "ChangeMe123" });
  return { token: login.body.data.accessToken, orgId: org.id };
}

async function makeSkill(token: string) {
  return (await request(app).post("/v1/competence/skills").set(authed(token)).send({ name: "Internal Auditing", type: "hard" })).body.data;
}
// A 4-question, 100-point exam: single(30), multi(30), truefalse(20), short(20).
const QUESTIONS = [
  { id: "q1", type: "single", text: "Pick one", points: 30, options: [{ id: "o1", text: "A", correct: true }, { id: "o2", text: "B", correct: false }] },
  { id: "q2", type: "multi", text: "Pick all", points: 30, options: [{ id: "o1", text: "A", correct: true }, { id: "o2", text: "B", correct: true }, { id: "o3", text: "C", correct: false }] },
  { id: "q3", type: "truefalse", text: "T/F", points: 20, answerTrue: true },
  { id: "q4", type: "short", text: "Explain", points: 20, model: "any" },
];

describe("competence instruments (exam ladder + practical)", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("auto-scores an exam across all question types and records a pass", async () => {
    const { token } = await makeTenant("ci1", "CI1");
    const skill = await makeSkill(token);
    const exam = (await request(app).post("/v1/competence/instruments/exams").set(authed(token)).send({ skillId: skill.id, level: 1, questions: QUESTIONS, passMark: 70 })).body.data;
    expect(exam).toMatchObject({ level: 1, status: "Draft", passMark: 70 });

    // All correct + full short marks → 100%, passed.
    const perfect = await request(app).post(`/v1/competence/instruments/exams/${exam.id}/take`).set(authed(token)).send({
      personId: PERSON, personName: "Jane", answers: { q1: "o1", q2: ["o1", "o2"], q3: "true", q4: { points: 20 } },
    });
    expect(perfect.body.data).toMatchObject({ score: 100, earned: 100, total: 100, passed: true });

    // multi with a wrong extra selection scores 0 for that question; short partial 10 → 60/100 fail.
    const partial = await request(app).post(`/v1/competence/instruments/exams/${exam.id}/take`).set(authed(token)).send({
      personId: PERSON, answers: { q1: "o1", q2: ["o1", "o2", "o3"], q3: "false", q4: { points: 10 } },
    });
    // q1 30 + q2 0 (exact-set fails) + q3 0 (wrong) + q4 10 = 40 → 40% fail.
    expect(partial.body.data).toMatchObject({ score: 40, passed: false });

    // preview does not persist an attempt.
    const preview = await request(app).post(`/v1/competence/instruments/exams/${exam.id}/take`).set(authed(token)).send({ personId: PERSON, preview: true, answers: { q1: "o1" } });
    expect(preview.body.data.id).toBeNull();
    // Two persisted attempts so far.
    expect((await request(app).get(`/v1/competence/attempts?personId=${PERSON}`).set(authed(token))).body.data.exams).toHaveLength(2);
  });

  it("computes the ladder: consecutive exam passes then L4 practical → level 4", async () => {
    const { token } = await makeTenant("ci2", "CI2");
    const skill = await makeSkill(token);
    const easy = [{ id: "q1", type: "truefalse", text: "T", points: 100, answerTrue: true }];
    const mkExam = async (level: number) => {
      const e = (await request(app).post("/v1/competence/instruments/exams").set(authed(token)).send({ skillId: skill.id, level, questions: easy })).body.data;
      await request(app).post(`/v1/competence/instruments/exams/${e.id}/status`).set(authed(token)).send({ status: "Published" });
      return e;
    };
    const [e1, e2, e3] = [await mkExam(1), await mkExam(2), await mkExam(3)];
    const pass = (e: { id: string }) => request(app).post(`/v1/competence/instruments/exams/${e.id}/take`).set(authed(token)).send({ personId: PERSON, answers: { q1: "true" } });

    await pass(e1);
    let lvl = (await request(app).get(`/v1/competence/skills/${skill.id}/level?personId=${PERSON}`).set(authed(token))).body.data;
    expect(lvl).toMatchObject({ examAchievedLevel: 1, compInstrLevel: 1, nextLevel: 2 });

    // Skip L2, pass L3 → still only L1 achieved (must be consecutive).
    await pass(e3);
    lvl = (await request(app).get(`/v1/competence/skills/${skill.id}/level?personId=${PERSON}`).set(authed(token))).body.data;
    expect(lvl.examAchievedLevel).toBe(1);

    // Pass L2 → now L3 achieved.
    await pass(e2);
    lvl = (await request(app).get(`/v1/competence/skills/${skill.id}/level?personId=${PERSON}`).set(authed(token))).body.data;
    expect(lvl).toMatchObject({ examAchievedLevel: 3, practicalPassed: false, compInstrLevel: 3, nextLevel: 0 });

    // Publish + pass an L4 practical → compInstrLevel 4.
    const prac = (await request(app).post("/v1/competence/instruments/practicals").set(authed(token)).send({ skillId: skill.id, passMark: 75, criteria: [{ id: "c1", text: "Demonstrates audit", points: 10 }] })).body.data;
    const run = await request(app).post(`/v1/competence/instruments/practicals/${prac.id}/run`).set(authed(token)).send({ personId: PERSON, assessor: "Lead", scores: { c1: 9 } });
    expect(run.body.data).toMatchObject({ score: 90, passed: true, level: 4 });
    lvl = (await request(app).get(`/v1/competence/skills/${skill.id}/level?personId=${PERSON}`).set(authed(token))).body.data;
    expect(lvl).toMatchObject({ examAchievedLevel: 3, practicalPassed: true, compInstrLevel: 4 });
  });

  it("enforces grants + validates exam level", async () => {
    const { token } = await makeTenant("ci3", "CI3");
    const skill = await makeSkill(token);
    expect((await request(app).post("/v1/competence/instruments/exams").set(authed(token)).send({ skillId: skill.id, level: 5 })).status).toBe(400);
    const readonly = await makeTenant("ci4", "CI4", [ACTIONS.COMPETENCE_READ]);
    expect((await request(app).get("/v1/competence/instruments/exams").set(authed(readonly.token))).status).toBe(200);
    expect((await request(app).post("/v1/competence/instruments/exams").set(authed(readonly.token)).send({ skillId: skill.id, level: 1 })).status).toBe(403);
  });
});
