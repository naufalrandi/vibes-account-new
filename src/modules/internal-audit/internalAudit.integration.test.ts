import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import { initModels, Organization, User, Role } from "../../db/models";
import { hashPassword } from "../../lib/password";
import { resetDb, grantActions } from "../../../test/helpers";
import { ACTIONS } from "../iam/actions.catalog";

const app = createApp();
const authed = (t: string) => ({ Authorization: `Bearer ${t}` });
const IA = [ACTIONS.IAUDIT_READ, ACTIONS.IAUDIT_MANAGE, ACTIONS.MS_READ, ACTIONS.MS_MANAGE];

async function makeTenant(username: string, code: string, actions: string[] = IA): Promise<{ token: string; orgId: string }> {
  const org = await Organization.create({ name: code, code, type: "Tenant", status: "Active", parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null });
  await User.create({ orgId: org.id, tenantId: null, fullName: "Lead Auditor", username, email: `${username}@x.io`, passwordHash: await hashPassword("ChangeMe123"), status: "Active", position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null });
  const role = await Role.create({ name: `R-${username}`, tierScope: "Tenant", orgId: org.id, isSuperAdmin: false, status: true });
  const u = await User.findOne({ where: { username } });
  await (u as unknown as { setRoles: (r: Role[]) => Promise<unknown> }).setRoles([role]);
  await grantActions(role.id, actions);
  const login = await request(app).post("/v1/auth/login").send({ identifier: username, password: "ChangeMe123" });
  return { token: login.body.data.accessToken, orgId: org.id };
}

const PROGRAM = {
  name: "June 2026 Integrated Internal Audit Program",
  period: "2026-06",
  processes: ["Software Development", "IT Infrastructure"],
  criteria: ["ISO 9001:2015"],
  leadAuditor: "Jennifer Susan Walters",
  auditors: ["Scott Edward Harris Lang"],
};

describe("internal audit", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("runs the full program → plan → session → finding → report workflow", async () => {
    const { token } = await makeTenant("ia1", "IA1");

    // Program: required-field validation + auto code + Draft default.
    expect((await request(app).post("/v1/internal-audit/programs").set(authed(token)).send({ ...PROGRAM, processes: [] })).status).toBe(400);
    const prog = await request(app).post("/v1/internal-audit/programs").set(authed(token)).send(PROGRAM);
    expect(prog.status).toBe(201);
    expect(prog.body.data).toMatchObject({ code: "IAP-0001", status: "Draft", leadAuditor: PROGRAM.leadAuditor });
    const programId = prog.body.data.id;

    // Approve only from Draft.
    const approved = await request(app).post(`/v1/internal-audit/programs/${programId}/status`).set(authed(token)).send({ status: "Approved" });
    expect(approved.body.data.status).toBe("Approved");
    expect((await request(app).post(`/v1/internal-audit/programs/${programId}/status`).set(authed(token)).send({ status: "Approved" })).status).toBe(409);

    // Plan inherits processes/criteria from the program.
    const plan = await request(app).post("/v1/internal-audit/plans").set(authed(token)).send({ programId, name: "SD + IT Plan" });
    expect(plan.body.data).toMatchObject({ code: "IAPL-0001", programId, status: "Draft" });
    expect(plan.body.data.criteria).toEqual(["ISO 9001:2015"]);
    const planId = plan.body.data.id;

    // Session derives programId from the plan.
    const session = await request(app).post("/v1/internal-audit/sessions").set(authed(token))
      .send({ planId, title: "SD opening meeting", date: "2026-06-15", start: "09:00", end: "12:00", process: "Software Development", auditor: "Scott Edward Harris Lang" });
    expect(session.body.data).toMatchObject({ code: "IAS-0001", programId, status: "Scheduled" });
    const sessionId = session.body.data.id;
    const done = await request(app).post(`/v1/internal-audit/sessions/${sessionId}/status`).set(authed(token)).send({ status: "Completed" });
    expect(done.body.data.status).toBe("Completed");

    // Settings default to mandatoryReview=true.
    expect((await request(app).get("/v1/internal-audit/settings").set(authed(token))).body.data.mandatoryReview).toBe(true);

    // Finding draft (evidence required) then submit → pending lead-auditor review.
    expect((await request(app).post("/v1/internal-audit/findings").set(authed(token)).send({ programId, title: "No evidence", description: "x", process: "Software Development" })).status).toBe(400);
    const finding = await request(app).post("/v1/internal-audit/findings").set(authed(token))
      .send({ programId, sessionId, title: "Missing test records", type: "Nonconformity", description: "Unit test evidence absent", process: "Software Development", evidence: "Sampled 5 commits, no test logs", pic: "Gwendolyne Maxine Stacy" });
    expect(finding.body.data).toMatchObject({ code: "IAF-0001", reviewStatus: "Not Required", issueStatus: "Draft", auditor: "Lead Auditor" });
    const findingId = finding.body.data.id;

    const submitted = await request(app).put(`/v1/internal-audit/findings/${findingId}`).set(authed(token)).send({ submit: true });
    expect(submitted.body.data).toMatchObject({ reviewStatus: "Pending Lead Auditor Review", issueStatus: "Pending Lead Auditor Review", reviewRequired: true });

    // Lead-auditor approves → ready to issue.
    const reviewed = await request(app).post(`/v1/internal-audit/findings/${findingId}/review`).set(authed(token)).send({ decision: "Approve Finding", reviewNotes: "Confirmed" });
    expect(reviewed.body.data).toMatchObject({ reviewStatus: "Approved", issueStatus: "Ready to Issue", reviewDecision: "Approve Finding" });

    // Issue (PIC present) → Issued.
    const issued = await request(app).post(`/v1/internal-audit/findings/${findingId}/issue`).set(authed(token)).send({});
    expect(issued.body.data).toMatchObject({ issueStatus: "Issued", issuedTo: "Gwendolyne Maxine Stacy" });

    // Route to NC → creates an NCR register record + links back.
    const routed = await request(app).post(`/v1/internal-audit/findings/${findingId}/route`).set(authed(token)).send({ target: "nc" });
    expect(routed.body.data.issueStatus).toBe("Follow-up Created");
    expect(routed.body.data.linkedNC).toBe("NCR-0001");
    const ncs = await request(app).get("/v1/implementation/nonconformities").set(authed(token));
    expect(ncs.body.data).toHaveLength(1);
    expect(ncs.body.data[0].data).toMatchObject({ category: "Audit Finding", sourceFindingId: "IAF-0001" });

    // Generate report → snapshots plan/session/finding codes; program auto-promotes.
    const report = await request(app).post("/v1/internal-audit/reports").set(authed(token)).send({ programId, summary: "Two sessions completed." });
    expect(report.body.data).toMatchObject({ code: "IAR-0001", period: "2026-06", status: "Generated" });
    expect(report.body.data.findings).toContain("IAF-0001");
    expect(report.body.data.plans).toContain("IAPL-0001");
  });

  it("issues without review when mandatoryReview is disabled", async () => {
    const { token } = await makeTenant("ia2", "IA2");
    await request(app).put("/v1/internal-audit/settings").set(authed(token)).send({ mandatoryReview: false });
    const prog = await request(app).post("/v1/internal-audit/programs").set(authed(token)).send(PROGRAM);
    const programId = prog.body.data.id;
    const finding = await request(app).post("/v1/internal-audit/findings").set(authed(token))
      .send({ programId, title: "Observation", type: "Observation", description: "Minor gap", process: "IT Infrastructure", evidence: "noted", pic: "Someone", submit: true });
    // No mandatory review → straight to Ready to Issue.
    expect(finding.body.data.issueStatus).toBe("Ready to Issue");
    const issued = await request(app).post(`/v1/internal-audit/findings/${finding.body.data.id}/issue`).set(authed(token)).send({});
    expect(issued.body.data.issueStatus).toBe("Issued");
    // An observation routes to an improvement, not an NC.
    expect((await request(app).post(`/v1/internal-audit/findings/${finding.body.data.id}/route`).set(authed(token)).send({ target: "nc" })).status).toBe(400);
    const routed = await request(app).post(`/v1/internal-audit/findings/${finding.body.data.id}/route`).set(authed(token)).send({ target: "imp" });
    expect(routed.body.data.linkedImp).toBe("IMP-0001");
  });

  it("scopes per tenant and enforces action grants", async () => {
    const a = await makeTenant("ia3", "IA3");
    const b = await makeTenant("ia4", "IA4");
    await request(app).post("/v1/internal-audit/programs").set(authed(a.token)).send(PROGRAM);
    expect((await request(app).get("/v1/internal-audit/programs").set(authed(b.token))).body.data).toHaveLength(0);

    const noGrant = await makeTenant("ia5", "IA5", []);
    expect((await request(app).get("/v1/internal-audit/programs").set(authed(noGrant.token))).status).toBe(403);
    const readonly = await makeTenant("ia6", "IA6", [ACTIONS.IAUDIT_READ]);
    expect((await request(app).get("/v1/internal-audit/programs").set(authed(readonly.token))).status).toBe(200);
    expect((await request(app).post("/v1/internal-audit/programs").set(authed(readonly.token)).send(PROGRAM)).status).toBe(403);
  });
});
