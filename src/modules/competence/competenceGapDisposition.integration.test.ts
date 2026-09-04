import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import { initModels, Organization, User, Role, CompetenceEducation, AuditLog } from "../../db/models";
import { hashPassword } from "../../lib/password";
import { resetDb, grantActions } from "../../../test/helpers";
import { ACTIONS } from "../iam/actions.catalog";
import {
  computeGapDisposition, bindGapToNewTrainingPlan, recordGapReassessment, resolveGapFromTrainingPlanClosed,
} from "./competence.assessment.service";
import type { AuthContext } from "../../lib/scope";

const app = createApp();
const authed = (t: string) => ({ Authorization: `Bearer ${t}` });
const CO = [ACTIONS.COMPETENCE_READ, ACTIONS.COMPETENCE_MANAGE];
const PERSON = "33333333-3333-3333-3333-333333333333";

async function makeTenant(username: string, code: string): Promise<{ token: string; orgId: string; userId: string }> {
  const org = await Organization.create({ name: code, code, type: "Tenant", status: "Active", parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null });
  await User.create({ orgId: org.id, tenantId: null, fullName: "Assessor", username, email: `${username}@x.io`, passwordHash: await hashPassword("ChangeMe123"), status: "Active", position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null });
  const role = await Role.create({ name: `R-${username}`, tierScope: "Tenant", orgId: org.id, isSuperAdmin: false, status: true });
  const u = await User.findOne({ where: { username } });
  await (u as unknown as { setRoles: (r: Role[]) => Promise<unknown> }).setRoles([role]);
  await grantActions(role.id, CO);
  const login = await request(app).post("/v1/auth/login").send({ identifier: username, password: "ChangeMe123" });
  return { token: login.body.data.accessToken, orgId: org.id, userId: u!.id };
}

/** Produce a real Open competence gap via the assessment scoring engine
 * (mirrors competenceAssessment.integration.test.ts's `scaffold`/ca3 case):
 * a Required hard skill assessed one level below its requirement scores
 * "partial", which `generateGaps` opens as a gap. */
async function makeOpenGap(token: string) {
  const edu = (await CompetenceEducation.create({ level: 6, label: "Bachelor's", description: null })).get({ plain: true });
  const hard = (await request(app).post("/v1/competence/skills").set(authed(token)).send({ name: "Internal Auditing", type: "hard", methods: ["Written exam"] })).body.data;
  const role = (await request(app).post("/v1/competence/roles").set(authed(token)).send({
    name: "Quality Manager", reviewFreq: "12", eduMinLevelId: edu.id,
    responsibilities: [{ id: "r1", text: "Lead audits", comps: [{ kind: "hard", refId: hard.id, necessity: "Required", level: 3 }] }],
  })).body.data;
  const asg = (await request(app).post("/v1/competence/assignments").set(authed(token)).send({ personId: PERSON, personName: "Jane Auditor", roleId: role.id })).body.data;
  await request(app).post("/v1/competence/assessments").set(authed(token)).send({
    assignmentId: asg.id, date: "2026-06-01",
    requirements: [{ key: "edu", result: "Met" }, { key: `hard:${hard.id}`, assessedLevel: 2 }],
  });
  const gaps: { id: string; status: string; disposition: string }[] = (await request(app).get("/v1/competence/gaps").set(authed(token))).body.data;
  expect(gaps).toHaveLength(1);
  return gaps[0];
}

describe("compGapTpBadge() precedence — pure function (index.html:14215)", () => {
  it("Gap Closed wins over every other flag, even if noTraining/trainingPlanId are also set", () => {
    expect(computeGapDisposition({ status: "Resolved", noTraining: true, trainingPlanId: "TP-1" })).toBe("Gap Closed");
  });
  it("No Training Required wins over an absent training plan", () => {
    expect(computeGapDisposition({ status: "Open", noTraining: true, trainingPlanId: null })).toBe("No Training Required");
  });
  it("Training Plan Required when open, not noTraining, and no plan linked", () => {
    expect(computeGapDisposition({ status: "Open", noTraining: false, trainingPlanId: null })).toBe("Training Plan Required");
  });
  it("surfaces the linked plan's Pending Reassessment state", () => {
    expect(computeGapDisposition({ status: "Planned", noTraining: false, trainingPlanId: "TP-1" }, "Pending Reassessment")).toBe("Pending Reassessment");
  });
  it("falls back to Training Plan Created when a plan is linked and its state is unknown/other", () => {
    expect(computeGapDisposition({ status: "Planned", noTraining: false, trainingPlanId: "TP-1" })).toBe("Training Plan Created");
    expect(computeGapDisposition({ status: "Planned", noTraining: false, trainingPlanId: "TP-1" }, "Completed")).toBe("Training Plan Created");
  });
});

describe("competence gap dispositions (G-02)", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("Link Existing Training Plan: sets trainingPlanId + clears noTraining, no status transition, logs OD's wording", async () => {
    const { token, orgId } = await makeTenant("gd1", "GD1");
    const gap = await makeOpenGap(token);
    expect(gap.disposition).toBe("Training Plan Required");

    const res = await request(app).post(`/v1/competence/gaps/${gap.id}/link-training-plan`).set(authed(token)).send({ trainingPlanId: "TP-0001" });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ trainingPlanId: "TP-0001", noTraining: false, status: "Open", disposition: "Training Plan Created" });

    const log = await AuditLog.findOne({ where: { organizationId: orgId, action: "competence.gap.trainingLinked" }, order: [["at", "DESC"]] });
    expect(log?.metadata).toMatchObject({ activity: "linked a training plan", detail: "TP-0001" });
  });

  it("rejects linking with no training plan selected", async () => {
    const { token } = await makeTenant("gd2", "GD2");
    const gap = await makeOpenGap(token);
    const res = await request(app).post(`/v1/competence/gaps/${gap.id}/link-training-plan`).set(authed(token)).send({});
    expect(res.status).toBe(400);
  });

  it("No Training Required: rejects an empty/whitespace justification, then accepts a real one", async () => {
    const { token, orgId } = await makeTenant("gd3", "GD3");
    const gap = await makeOpenGap(token);

    const empty = await request(app).post(`/v1/competence/gaps/${gap.id}/no-training`).set(authed(token)).send({ reason: "   " });
    expect(empty.status).toBe(400);
    expect(empty.body.error.code).toBe("REASON_REQUIRED");

    const ok = await request(app).post(`/v1/competence/gaps/${gap.id}/no-training`).set(authed(token)).send({ reason: "Role is being retired; no further training planned." });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ noTraining: true, noTrainingReason: "Role is being retired; no further training planned.", disposition: "No Training Required" });

    const log = await AuditLog.findOne({ where: { organizationId: orgId, action: "competence.gap.noTrainingRequired" }, order: [["at", "DESC"]] });
    expect(log?.metadata).toMatchObject({ activity: "marked no training required" });
    // OD `ocTrunc(r,50)`: 50-char reason truncates to 49 chars + ellipsis.
    expect((log?.metadata as { detail: string }).detail.length).toBeLessThanOrEqual(50);
  });

  it("bindGapToNewTrainingPlan (Create Training Plan disposition, contract for the implementation module): Open -> Planned", async () => {
    const { token, orgId, userId } = await makeTenant("gd4", "GD4");
    const gap = await makeOpenGap(token);
    const auth: AuthContext = { userId, orgId, tenantId: null, orgType: "Tenant", isSuperAdmin: false, actions: CO };

    const updated = await bindGapToNewTrainingPlan(auth, gap.id, "TP-0042", null);
    expect(updated).toMatchObject({ status: "Planned", trainingPlanId: "TP-0042", disposition: "Training Plan Created" });
  });

  it("recordGapReassessment: Meets Requirement resolves the gap; anything else reopens it", async () => {
    const { token, orgId, userId } = await makeTenant("gd5", "GD5");
    const gap = await makeOpenGap(token);
    const auth: AuthContext = { userId, orgId, tenantId: null, orgType: "Tenant", isSuperAdmin: false, actions: CO };

    const reopened = await recordGapReassessment(auth, gap.id, "Partially Meets", "TP-0007", null);
    expect(reopened).toMatchObject({ status: "Open", reassessResult: "Partially Meets", disposition: "Training Plan Required" });

    const resolved = await recordGapReassessment(auth, gap.id, "Meets Requirement", "TP-0007", null);
    expect(resolved).toMatchObject({ status: "Resolved", reassessResult: "Meets Requirement", resolvedBy: "TP-0007", disposition: "Gap Closed" });
    expect(resolved.resolvedDate).toBeTruthy();
  });

  it("resolveGapFromTrainingPlanClosed: resolves once, then is a no-op guarded by status!=='Resolved'", async () => {
    const { token, orgId, userId } = await makeTenant("gd6", "GD6");
    const gap = await makeOpenGap(token);
    const auth: AuthContext = { userId, orgId, tenantId: null, orgType: "Tenant", isSuperAdmin: false, actions: CO };

    const first = await resolveGapFromTrainingPlanClosed(auth, gap.id, "TP-0099", null);
    expect(first).toMatchObject({ status: "Resolved", resolvedBy: "TP-0099", disposition: "Gap Closed" });
    const firstDate = first.resolvedDate;

    // Second call is a guarded no-op (OD `gp.status!=='Resolved'` check) — no new activity, resolvedDate unchanged.
    const second = await resolveGapFromTrainingPlanClosed(auth, gap.id, "TP-0100", null);
    expect(second).toMatchObject({ status: "Resolved", resolvedBy: "TP-0099", resolvedDate: firstDate });

    const logs = await AuditLog.count({ where: { organizationId: orgId, action: "competence.gap.trainingPlanClosed" } });
    expect(logs).toBe(1);
  });

  it("reviews, un-reviews, and refuses a double review", async () => {
      const { token } = await makeTenant("gd4", "GD4");
      const gap = await makeOpenGap(token);

      const reviewed = await request(app).post(`/v1/competence/gaps/${gap.id}/review`).set(authed(token)).send({});
      expect(reviewed.status).toBe(200);
      expect(reviewed.body.data.status).toBe("Reviewed");
      // The columns exist on the model but nothing wrote them until this endpoint.
      expect(reviewed.body.data.reviewedBy).toBeTruthy();
      expect(reviewed.body.data.reviewedDate).toBeTruthy();

      const again = await request(app).post(`/v1/competence/gaps/${gap.id}/review`).set(authed(token)).send({});
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe("ALREADY_REVIEWED");

      const back = await request(app).post(`/v1/competence/gaps/${gap.id}/unreview`).set(authed(token)).send({});
      expect(back.status).toBe(200);
      expect(back.body.data).toMatchObject({ status: "Open", reviewedBy: null, reviewedDate: null });

      // Un-reviewing something that was never reviewed is refused, not a no-op.
      expect((await request(app).post(`/v1/competence/gaps/${gap.id}/unreview`).set(authed(token)).send({})).status).toBe(409);
    });

  it("reopen clears the No Training Required disposition", async () => {
      const { token } = await makeTenant("gd5", "GD5");
      const gap = await makeOpenGap(token);

      await request(app).post(`/v1/competence/gaps/${gap.id}/no-training`).set(authed(token)).send({ reason: "Role retired" });
      await request(app).put(`/v1/competence/gaps/${gap.id}`).set(authed(token)).send({ status: "Resolved" });

      const reopened = await request(app).post(`/v1/competence/gaps/${gap.id}/reopen`).set(authed(token)).send({});
      expect(reopened.status).toBe(200);
      expect(reopened.body.data).toMatchObject({
        status: "Open", noTraining: false, noTrainingReason: null, disposition: "Training Plan Required",
      });
      // Already open — refused rather than silently re-clearing.
      expect((await request(app).post(`/v1/competence/gaps/${gap.id}/reopen`).set(authed(token)).send({})).status).toBe(409);
    });
});
