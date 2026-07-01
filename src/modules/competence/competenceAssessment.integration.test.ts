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
const PERSON = "11111111-1111-1111-1111-111111111111";

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

// Build role (edu + Required hard L3 rf6 + Required training + Preferred soft L2) and assign a person.
async function scaffold(token: string) {
  const edu = (await request(app).post("/v1/competence/education").set(authed(token)).send({ level: 6, label: "Bachelor's" })).body.data;
  const hard = (await request(app).post("/v1/competence/skills").set(authed(token)).send({ name: "Internal Auditing", type: "hard", methods: ["Written exam"] })).body.data;
  const soft = (await request(app).post("/v1/competence/skills").set(authed(token)).send({ name: "Communication", type: "soft" })).body.data;
  const tr = (await request(app).post("/v1/competence/training").set(authed(token)).send({ name: "ISO 9001 Lead Auditor" })).body.data;
  const role = (await request(app).post("/v1/competence/roles").set(authed(token)).send({
    name: "Quality Manager", reviewFreq: "12", eduMinLevelId: edu.id,
    responsibilities: [{ id: "r1", text: "Lead audits", comps: [{ kind: "hard", refId: hard.id, necessity: "Required", level: 3, reviewFreq: "6" }, { kind: "training", refId: tr.id, necessity: "Required" }] }],
    authorities: [{ id: "a1", text: "Approve reports", comps: [{ kind: "soft", refId: soft.id, necessity: "Preferred", level: 2 }] }],
  })).body.data;
  const asg = (await request(app).post("/v1/competence/assignments").set(authed(token)).send({ personId: PERSON, personName: "Jane Auditor", roleId: role.id })).body.data;
  return { edu, hard, soft, tr, role, asg, keys: { hard: `hard:${hard.id}`, soft: `soft:${soft.id}`, training: `training:${tr.id}` } };
}

describe("competence assessments (scoring engine)", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("builds the checklist from the role profile", async () => {
    const { token } = await makeTenant("ca1", "CA1");
    const s = await scaffold(token);
    const cl = (await request(app).get(`/v1/competence/assignments/${s.asg.id}/checklist`).set(authed(token))).body.data as { key: string; evalType: string; necessity: string; reqLevel: number }[];
    const byKey = Object.fromEntries(cl.map((r) => [r.key, r]));
    expect(cl).toHaveLength(4);
    expect(byKey["edu"]).toMatchObject({ evalType: "threshold", necessity: "Required" });
    expect(byKey[s.keys.hard]).toMatchObject({ evalType: "proficiency", necessity: "Required", reqLevel: 3 });
    expect(byKey[s.keys.training]).toMatchObject({ evalType: "passfail", necessity: "Required" });
    expect(byKey[s.keys.soft]).toMatchObject({ evalType: "proficiency", necessity: "Preferred", reqLevel: 2 });
  });

  it("scores Competent (100%) with the per-competence valid-until override", async () => {
    const { token } = await makeTenant("ca2", "CA2");
    const s = await scaffold(token);
    const a = await request(app).post("/v1/competence/assessments").set(authed(token)).send({
      assignmentId: s.asg.id, assessor: "Lead", date: "2026-06-01",
      requirements: [{ key: "edu", result: "Met" }, { key: s.keys.hard, assessedLevel: 3 }, { key: s.keys.training, result: "Passed" }, { key: s.keys.soft, assessedLevel: 2 }],
    });
    expect(a.body.data).toMatchObject({ status: "Competent", score: 100, openGaps: 0, validUntil: "2026-12-01" }); // min(role 12, hard 6) = 6 months
    expect((await request(app).get("/v1/competence/gaps").set(authed(token))).body.data).toHaveLength(0);
    // Assignment is denormalized with the latest result.
    const asg = (await request(app).get("/v1/competence/assignments").set(authed(token))).body.data[0];
    expect(asg).toMatchObject({ latestStatus: "Competent", validUntil: "2026-12-01" });
  });

  it("scores Competent-with-conditions and opens a gap, then reassessment resolves it", async () => {
    const { token } = await makeTenant("ca3", "CA3");
    const s = await scaffold(token);
    // hard assessed at L2 vs required L3 → partial.
    const a1 = await request(app).post("/v1/competence/assessments").set(authed(token)).send({
      assignmentId: s.asg.id, date: "2026-06-01",
      requirements: [{ key: "edu", result: "Met" }, { key: s.keys.hard, assessedLevel: 2 }, { key: s.keys.training, result: "Passed" }, { key: s.keys.soft, assessedLevel: 1 }],
    });
    // met lines = edu + training = 2 of 4 → 50%. hard (L2<L3) and soft (L1<L2) are both 'partial', not met.
    expect(a1.body.data).toMatchObject({ status: "Competent with conditions", openGaps: 1, score: 50 });
    const gaps = (await request(app).get("/v1/competence/gaps").set(authed(token))).body.data;
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({ reqKey: s.keys.hard, severity: "partial", status: "Open", currentLevel: 2, requiredLevel: 3, code: "GAP-0001" });

    // Reassess with hard now at L3 (met) → gap resolved, status Competent.
    const a2 = await request(app).post("/v1/competence/assessments").set(authed(token)).send({
      assignmentId: s.asg.id, date: "2026-09-01",
      requirements: [{ key: "edu", result: "Met" }, { key: s.keys.hard, assessedLevel: 3 }, { key: s.keys.training, result: "Passed" }, { key: s.keys.soft, assessedLevel: 2 }],
    });
    expect(a2.body.data.status).toBe("Competent");
    const gaps2 = (await request(app).get("/v1/competence/gaps").set(authed(token))).body.data;
    expect(gaps2[0]).toMatchObject({ status: "Resolved", resolvedDate: "2026-09-01" });
  });

  it("scores Not-yet-competent when a required line fails, and approval signs off", async () => {
    const { token } = await makeTenant("ca4", "CA4");
    const s = await scaffold(token);
    const a = await request(app).post("/v1/competence/assessments").set(authed(token)).send({
      assignmentId: s.asg.id, date: "2026-06-01",
      requirements: [{ key: "edu", result: "Met" }, { key: s.keys.hard, assessedLevel: 1 }, { key: s.keys.training, result: "Failed" }, { key: s.keys.soft, assessedLevel: 2 }],
    });
    expect(a.body.data.status).toBe("Not yet competent");
    const gaps = (await request(app).get("/v1/competence/gaps").set(authed(token))).body.data;
    // hard L1 vs L3 → 'not'; training Failed → 'not'. Both Required → 2 gaps.
    expect(gaps).toHaveLength(2);
    expect(gaps.map((g: { severity: string }) => g.severity).sort()).toEqual(["not", "not"]);

    const approved = await request(app).post(`/v1/competence/assessments/${a.body.data.id}/approve`).set(authed(token)).send({});
    expect(approved.body.data).toMatchObject({ approvalState: "Approved" });
    expect(approved.body.data.approvedBy).toBeTruthy();
  });

  it("enforces action grants for competence roles/assessments", async () => {
    const readonly = await makeTenant("ca5", "CA5", [ACTIONS.COMPETENCE_READ]);
    expect((await request(app).get("/v1/competence/roles").set(authed(readonly.token))).status).toBe(200);
    expect((await request(app).post("/v1/competence/roles").set(authed(readonly.token)).send({ name: "x" })).status).toBe(403);
  });
});
