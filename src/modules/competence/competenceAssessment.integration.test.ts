import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { createApp } from "../../app";
import { initModels, Organization, User, Role, CompetenceEducation } from "../../db/models";
import { hashPassword } from "../../lib/password";
import { resetDb, grantActions } from "../../../test/helpers";
import { ACTIONS } from "../iam/actions.catalog";

const app = createApp();
const authed = (t: string) => ({ Authorization: `Bearer ${t}` });
const CO = [ACTIONS.COMPETENCE_READ, ACTIONS.COMPETENCE_MANAGE];
const PERSON = "11111111-1111-1111-1111-111111111111";

async function makeTenant(username: string, code: string, actions: string[] = CO): Promise<{ token: string; orgId: string; userId: string }> {
  const org = await Organization.create({ name: code, code, type: "Tenant", status: "Active", parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null });
  await User.create({ orgId: org.id, tenantId: null, fullName: "Assessor", username, email: `${username}@x.io`, passwordHash: await hashPassword("ChangeMe123"), status: "Active", position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null });
  const role = await Role.create({ name: `R-${username}`, tierScope: "Tenant", orgId: org.id, isSuperAdmin: false, status: true });
  const u = await User.findOne({ where: { username } });
  await (u as unknown as { setRoles: (r: Role[]) => Promise<unknown> }).setRoles([role]);
  await grantActions(role.id, actions);
  const login = await request(app).post("/v1/auth/login").send({ identifier: username, password: "ChangeMe123" });
  return { token: login.body.data.accessToken, orgId: org.id, userId: u!.id };
}

// Build role (edu + Required hard L3 rf6 + Required training + Preferred soft L2) and assign a person.
async function scaffold(token: string) {
  // The ISCED ladder is SP-managed reference data (tenant writes 403) — seed it directly.
  const edu = (await CompetenceEducation.create({ level: 6, label: "Bachelor's", description: null })).get({ plain: true });
  const hard = (await request(app).post("/v1/competence/skills").set(authed(token)).send({ name: "CA Bespoke Hard Skill", type: "hard", methods: ["Written exam"] })).body.data;
  const soft = (await request(app).post("/v1/competence/skills").set(authed(token)).send({ name: "CA Bespoke Soft Skill", type: "soft" })).body.data;
  const tr = (await request(app).post("/v1/competence/training").set(authed(token)).send({ name: "CA Bespoke Training Course" })).body.data;
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
    const { token, userId } = await makeTenant("ca4", "CA4", [...CO, ACTIONS.APPROVAL_READ, ACTIONS.APPROVAL_MANAGE]);
    // Competence sign-off now requires approval-pool membership, like every
    // other governed module.
    await request(app).put(`/v1/approvals/pools/${userId}`).set(authed(token)).send({ isMST: true });
    await request(app).put("/v1/approvals/settings").set(authed(token)).send({ selfApprovalAllowed: true });
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

  it("keeps Enterprise roles out of a tenant's own role list, and ?scope=enterprise returns only Enterprise's", async () => {
    const sp = await (async () => {
      const org = await Organization.create({ name: "SPCO", code: "SPCO", type: "ServiceOwner", status: "Active", parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null });
      await User.create({ orgId: org.id, tenantId: null, fullName: "SP", username: "ca6-sp", email: "ca6-sp@x.io", passwordHash: await hashPassword("ChangeMe123"), status: "Active", position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null });
      const role = await Role.create({ name: "R-ca6-sp", tierScope: "ServiceOwner", orgId: org.id, isSuperAdmin: false, status: true });
      const u = await User.findOne({ where: { username: "ca6-sp" } });
      await (u as unknown as { setRoles: (r: Role[]) => Promise<unknown> }).setRoles([role]);
      await grantActions(role.id, CO);
      const login = await request(app).post("/v1/auth/login").send({ identifier: "ca6-sp", password: "ChangeMe123" });
      return { token: login.body.data.accessToken as string };
    })();
    await request(app).post("/v1/competence/roles").set(authed(sp.token)).send({ name: "Lead Auditor" });

    const { token } = await makeTenant("ca6", "CA6");
    await request(app).post("/v1/competence/roles").set(authed(token)).send({ name: "Quality Manager" });

    const tenantRoles = (await request(app).get("/v1/competence/roles").set(authed(token))).body.data;
    expect(tenantRoles.map((r: { name: string }) => r.name)).toEqual(["Quality Manager"]);

    const spRoles = (await request(app).get("/v1/competence/roles?scope=enterprise").set(authed(sp.token))).body.data;
    expect(spRoles.map((r: { name: string }) => r.name)).toEqual(["Lead Auditor"]);
  });

  // Assignments/assessments/gaps carry a NOT NULL orgId, so "Enterprise" for
  // them means the Service Provider's own org. Without an explicit scope a
  // ServiceOwner read is unrestricted — which would put every tenant's records
  // on the Enterprise screens.
  it("?scope=enterprise narrows assignments to the Service Provider's own org", async () => {
    const sp = await (async () => {
      const org = await Organization.create({ name: "SPCO2", code: "SPCO2", type: "ServiceOwner", status: "Active", parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null });
      await User.create({ orgId: org.id, tenantId: null, fullName: "SP", username: "ca7-sp", email: "ca7-sp@x.io", passwordHash: await hashPassword("ChangeMe123"), status: "Active", position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null });
      const role = await Role.create({ name: "R-ca7-sp", tierScope: "ServiceOwner", orgId: org.id, isSuperAdmin: false, status: true });
      const u = await User.findOne({ where: { username: "ca7-sp" } });
      await (u as unknown as { setRoles: (r: Role[]) => Promise<unknown> }).setRoles([role]);
      await grantActions(role.id, CO);
      const login = await request(app).post("/v1/auth/login").send({ identifier: "ca7-sp", password: "ChangeMe123" });
      return { token: login.body.data.accessToken as string };
    })();

    // A tenant creates its own role + assignment.
    const { token } = await makeTenant("ca7", "CA7");
    const tRole = (await request(app).post("/v1/competence/roles").set(authed(token)).send({ name: "Operator" })).body.data;
    const created = await request(app).post("/v1/competence/assignments").set(authed(token))
      .send({ personId: randomUUID(), personName: "Tenant Person", roleId: tRole.id });
    expect(created.status).toBe(201);

    // Unscoped, the Service Owner sees the tenant's assignment...
    const all = (await request(app).get("/v1/competence/assignments").set(authed(sp.token))).body.data;
    expect(all.some((a: { personName: string }) => a.personName === "Tenant Person")).toBe(true);

    // ...but the Enterprise view must not.
    const ent = (await request(app).get("/v1/competence/assignments?scope=enterprise").set(authed(sp.token))).body.data;
    expect(ent.some((a: { personName: string }) => a.personName === "Tenant Person")).toBe(false);
  });

  // Competence is listed as a governed module on the Approvals screen, but
  // sign-off used to be an unguarded flag flip with no eligibility check at all.
  it("refuses competence sign-off from outside an approval pool", async () => {
    const { token } = await makeTenant("ca8", "CA8", [...CO, ACTIONS.APPROVAL_READ, ACTIONS.APPROVAL_MANAGE]);
    const s = await scaffold(token);
    const a = await request(app).post("/v1/competence/assessments").set(authed(token)).send({
      assignmentId: s.asg.id, date: "2026-06-01",
      requirements: [{ key: "edu", result: "Met" }],
    });

    const blocked = await request(app).post(`/v1/competence/assessments/${a.body.data.id}/approve`).set(authed(token)).send({});
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.message).toMatch(/approval pool/i);
  });

  it("refuses self-approval of one's own assessment unless the org allows it", async () => {
    const { token, userId } = await makeTenant("ca9", "CA9", [...CO, ACTIONS.APPROVAL_READ, ACTIONS.APPROVAL_MANAGE]);
    await request(app).put(`/v1/approvals/pools/${userId}`).set(authed(token)).send({ isMST: true });
    // Self-approval is permitted by default, so turn it off to exercise the rule.
    await request(app).put("/v1/approvals/settings").set(authed(token)).send({ selfApprovalAllowed: false });
    const s = await scaffold(token);

    // The assessor is recorded as the acting user's own name.
    const a = await request(app).post("/v1/competence/assessments").set(authed(token)).send({
      assignmentId: s.asg.id, date: "2026-06-01", assessor: "Assessor",
      requirements: [{ key: "edu", result: "Met" }],
    });

    const blocked = await request(app).post(`/v1/competence/assessments/${a.body.data.id}/approve`).set(authed(token)).send({});
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.message).toMatch(/self-approval/i);

    await request(app).put("/v1/approvals/settings").set(authed(token)).send({ selfApprovalAllowed: true });
    const allowed = await request(app).post(`/v1/competence/assessments/${a.body.data.id}/approve`).set(authed(token)).send({});
    expect(allowed.status).toBe(200);
  });

  // The Enterprise competence screens show the SP's own staff. Every other list
  // function honours `scope=enterprise`; the reassessment queue used to ignore
  // it, so a Service Owner saw every tenant's assignments on that tab.
  it("does not leak tenant assignments into the Enterprise reassessment queue", async () => {
    const tenant = await makeTenant("cq-tenant", "CQTEN");
    await scaffold(tenant.token);

    const so = await Organization.create({ name: "SO", code: "CQSO", type: "ServiceOwner", status: "Active", parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null });
    await User.create({ orgId: so.id, tenantId: null, fullName: "SO", username: "cq-so", email: "cq-so@x.io", passwordHash: await hashPassword("ChangeMe123"), status: "Active", position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null });
    const soRole = await Role.create({ name: "R-cq-so", tierScope: "ServiceOwner", orgId: so.id, isSuperAdmin: false, status: true });
    const soUser = await User.findOne({ where: { username: "cq-so" } });
    await (soUser as unknown as { setRoles: (r: Role[]) => Promise<unknown> }).setRoles([soRole]);
    await grantActions(soRole.id, CO);
    const soToken = (await request(app).post("/v1/auth/login").send({ identifier: "cq-so", password: "ChangeMe123" })).body.data.accessToken;

    const unscoped = await request(app).get("/v1/competence/assessments/reassess-queue").set(authed(soToken));
    expect(unscoped.body.data.never.length).toBe(1); // Service Owner's full view still works

    const enterprise = await request(app).get("/v1/competence/assessments/reassess-queue?scope=enterprise").set(authed(soToken));
    expect(enterprise.status).toBe(200);
    const all = [...enterprise.body.data.never, ...enterprise.body.data.overdue, ...enterprise.body.data.due];
    expect(all).toHaveLength(0);
    expect(all.some((a: { orgId: string }) => a.orgId === tenant.orgId)).toBe(false);
  });
});
