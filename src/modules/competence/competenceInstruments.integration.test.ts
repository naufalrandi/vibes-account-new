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

  it("auto-scores an exam; short answers park as PendingGrading until the assessor finalizes", async () => {
    const { token } = await makeTenant("ci1", "CI1");
    const skill = await makeSkill(token);
    const exam = (await request(app).post("/v1/competence/instruments/exams").set(authed(token)).send({ skillId: skill.id, level: 1, questions: QUESTIONS, passMark: 70 })).body.data;
    expect(exam).toMatchObject({ level: 1, status: "Draft", passMark: 70 });

    // The typed short answer parks the attempt as PendingGrading (auto portion 80/100 scored, not passed yet).
    const pending = await request(app).post(`/v1/competence/instruments/exams/${exam.id}/take`).set(authed(token)).send({
      personId: PERSON, personName: "Jane", answers: { q1: "o1", q2: ["o1", "o2"], q3: "true", q4: "Because the standard says so" },
    });
    expect(pending.body.data).toMatchObject({ status: "PendingGrading", score: 80, earned: 80, total: 100, passed: false });

    // Assessor awards the short-answer points → finalized: 100%, passed.
    const graded = await request(app).post(`/v1/competence/instruments/exams/attempts/${pending.body.data.id}/grade`).set(authed(token)).send({ grades: { q4: 20 } });
    expect(graded.body.data).toMatchObject({ status: "Completed", score: 100, earned: 100, total: 100, passed: true });
    // Re-grading a finalized attempt is rejected.
    expect((await request(app).post(`/v1/competence/instruments/exams/attempts/${pending.body.data.id}/grade`).set(authed(token)).send({ grades: { q4: 0 } })).status).toBe(400);

    // Inline grades finalize in one call: q1 30 + q2 0 (exact-set fails) + q3 0 (wrong) + q4 10 = 40 → 40% fail.
    const partial = await request(app).post(`/v1/competence/instruments/exams/${exam.id}/take`).set(authed(token)).send({
      personId: PERSON, answers: { q1: "o1", q2: ["o1", "o2", "o3"], q3: "false", q4: "meh" }, grades: { q4: 10 },
    });
    expect(partial.body.data).toMatchObject({ status: "Completed", score: 40, passed: false });

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

    // Ladder is enforced: L2/L3 are locked before L1 is achieved.
    const earlyL3 = await pass(e3);
    expect(earlyL3.status).toBe(400);
    expect(earlyL3.body.error.code).toBe("LADDER_LOCKED");

    await pass(e1);
    let lvl = (await request(app).get(`/v1/competence/skills/${skill.id}/level?personId=${PERSON}`).set(authed(token))).body.data;
    expect(lvl).toMatchObject({ examAchievedLevel: 1, compInstrLevel: 1, nextLevel: 2 });

    // Still can't skip: L3 needs L2 first.
    expect((await pass(e3)).status).toBe(400);

    // The L4 practical is locked until exam level 3 is achieved.
    const prac = (await request(app).post("/v1/competence/instruments/practicals").set(authed(token)).send({ skillId: skill.id, passMark: 75, criteria: [{ id: "c1", text: "Demonstrates audit", points: 10 }] })).body.data;
    const earlyPrac = await request(app).post(`/v1/competence/instruments/practicals/${prac.id}/run`).set(authed(token)).send({ personId: PERSON, assessor: "Lead", scores: { c1: 9 } });
    expect(earlyPrac.status).toBe(400);
    expect(earlyPrac.body.error.code).toBe("PRACTICAL_LOCKED");

    // Pass L2 then L3 in ladder order.
    await pass(e2);
    await pass(e3);
    lvl = (await request(app).get(`/v1/competence/skills/${skill.id}/level?personId=${PERSON}`).set(authed(token))).body.data;
    expect(lvl).toMatchObject({ examAchievedLevel: 3, practicalPassed: false, compInstrLevel: 3, nextLevel: 0 });

    // Pass the L4 practical → compInstrLevel 4.
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

  it("blocks duplicate skill+level instruments and validates before publishing (OD examValidate/pracValidate)", async () => {
    const { token } = await makeTenant("ci5", "CI5");
    const skill = await makeSkill(token);
    const exam = (await request(app).post("/v1/competence/instruments/exams").set(authed(token)).send({ skillId: skill.id, level: 1 })).body.data;

    // Second exam at the same skill+level is rejected.
    const dup = await request(app).post("/v1/competence/instruments/exams").set(authed(token)).send({ skillId: skill.id, level: 1 });
    expect(dup.status).toBe(400);
    expect(dup.body.error.code).toBe("EXAM_EXISTS");

    // Publishing with no questions is rejected.
    const noQ = await request(app).post(`/v1/competence/instruments/exams/${exam.id}/status`).set(authed(token)).send({ status: "Published" });
    expect(noQ.status).toBe(400);
    expect(noQ.body.error.code).toBe("EXAM_INVALID");

    // Single-choice without exactly one correct option is rejected.
    await request(app).put(`/v1/competence/instruments/exams/${exam.id}`).set(authed(token)).send({
      questions: [{ id: "q1", type: "single", text: "Pick", points: 10, options: [{ id: "o1", text: "A", correct: false }, { id: "o2", text: "B", correct: false }] }],
    });
    expect((await request(app).post(`/v1/competence/instruments/exams/${exam.id}/status`).set(authed(token)).send({ status: "Published" })).status).toBe(400);

    // A valid bank publishes.
    await request(app).put(`/v1/competence/instruments/exams/${exam.id}`).set(authed(token)).send({
      questions: [{ id: "q1", type: "single", text: "Pick", points: 10, options: [{ id: "o1", text: "A", correct: true }, { id: "o2", text: "B", correct: false }] }],
    });
    expect((await request(app).post(`/v1/competence/instruments/exams/${exam.id}/status`).set(authed(token)).send({ status: "Published" })).body.data.status).toBe("Published");

    // Practicals: duplicate per skill rejected; publishing without criteria rejected.
    const prac = (await request(app).post("/v1/competence/instruments/practicals").set(authed(token)).send({ skillId: skill.id })).body.data;
    const dupPrac = await request(app).post("/v1/competence/instruments/practicals").set(authed(token)).send({ skillId: skill.id });
    expect(dupPrac.status).toBe(400);
    expect(dupPrac.body.error.code).toBe("PRACTICAL_EXISTS");
    const noCrit = await request(app).post(`/v1/competence/instruments/practicals/${prac.id}/status`).set(authed(token)).send({ status: "Published" });
    expect(noCrit.status).toBe(400);
    expect(noCrit.body.error.code).toBe("PRACTICAL_INVALID");
  });

  it("scopes instruments per org: tenants see global + own, and cannot mutate another tenant's rows", async () => {
    const a = await makeTenant("ci6", "CI6");
    const b = await makeTenant("ci7", "CI7");
    const skill = await makeSkill(a.token);
    const examA = (await request(app).post("/v1/competence/instruments/exams").set(authed(a.token)).send({ skillId: skill.id, level: 1 })).body.data;
    expect(examA.orgId).toBe(a.orgId);

    // B does not see A's tenant-scoped exam (only the global bank-seeded rows, org_id
    // NULL — see `ensureInstrumentSeed`) and cannot mutate or delete it.
    const bList: { id: string; orgId: string | null }[] = (await request(app).get("/v1/competence/instruments/exams").set(authed(b.token))).body.data;
    expect(bList.some((x) => x.id === examA.id)).toBe(false);
    expect(bList.every((x) => x.orgId === null)).toBe(true);
    expect((await request(app).put(`/v1/competence/instruments/exams/${examA.id}`).set(authed(b.token)).send({ name: "x" })).status).toBe(403);
    expect((await request(app).delete(`/v1/competence/instruments/exams/${examA.id}`).set(authed(b.token))).status).toBe(403);
  });
});
