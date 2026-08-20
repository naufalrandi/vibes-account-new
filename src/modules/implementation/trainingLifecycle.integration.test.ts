import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { createApp } from "../../app";
import { CompetenceAssignment, CompetenceGap, CompetenceRole, initModels, Organization, User, Role } from "../../db/models";
import { hashPassword } from "../../lib/password";
import { resetDb, grantActions } from "../../../test/helpers";
import { ACTIONS } from "../iam/actions.catalog";

const app = createApp();
const authed = (t: string) => ({ Authorization: `Bearer ${t}` });
const MS = [ACTIONS.MS_READ, ACTIONS.MS_MANAGE];

async function makeTenant(username: string, code: string, actions = MS): Promise<{ token: string; orgId: string }> {
  const org = await Organization.create({ name: code, code, type: "Tenant", status: "Active", parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null });
  const user = await User.create({ orgId: org.id, tenantId: null, fullName: "T", username, email: `${username}@x.io`, passwordHash: await hashPassword("ChangeMe123"), status: "Active", position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null });
  const role = await Role.create({ name: `R-${username}`, tierScope: "Tenant", orgId: org.id, isSuperAdmin: false, status: true });
  await (user as unknown as { setRoles: (r: Role[]) => Promise<unknown> }).setRoles([role]);
  await grantActions(role.id, actions);
  const login = await request(app).post("/v1/auth/login").send({ identifier: username, password: "ChangeMe123" });
  return { token: login.body.data.accessToken, orgId: org.id };
}

/** A gap needs a real role + assignment behind it (both are FK-constrained). */
async function seedGap(orgId: string, code: string) {
  const role = await CompetenceRole.create({
    orgId, code: `ROL-${code}`, name: "Internal Auditor", description: null,
    eduMinLevelId: null, eduFields: [], eduCountry: null, expReqs: [],
    responsibilities: [], authorities: [], reviewFreq: "12", status: "Active",
  });
  const personId = randomUUID();
  const assignment = await CompetenceAssignment.create({
    orgId, personId, personName: "Sam", roleId: role.id, assignedDate: "2026-01-01", status: "Active",
    latestAssessmentId: null, latestStatus: null, latestDate: null, validUntil: null,
  });
  return CompetenceGap.create({
    orgId, code, assessmentId: null, assignmentId: assignment.id, personId, roleId: role.id,
    reqKey: "skill:1", reqLabel: "Internal Auditing", kind: "hard", evalType: "proficiency",
    severity: "not", action: null, owner: null, due: null, training: null, trainingDate: null,
    resolvedDate: null, resolvedBy: null, createdDate: null,
  });
}

describe("Training Plan lifecycle (OD tp*)", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("mints TP-prefixed codes and enforces the exact TP_STATUS vocabulary", async () => {
    const { token } = await makeTenant("tp1", "TPT1");
    const created = await request(app).post("/v1/implementation/training").set(authed(token))
      .send({ title: "Data Privacy Awareness Training", status: "Planned", data: { source: "Manual" } });
    expect(created.status).toBe(201);
    expect(created.body.data.code).toBe("TP-0001");

    const badStatus = await request(app).post("/v1/implementation/training").set(authed(token))
      .send({ title: "x", status: "Overdue" });
    expect(badStatus.status).toBe(400);
    expect(badStatus.body.error.code).toBe("INVALID_STATUS");
  });

  it("validates source/type/delivery against the OD vocabulary on write", async () => {
    const { token } = await makeTenant("tp2", "TPT2");
    const badSource = await request(app).post("/v1/implementation/training").set(authed(token))
      .send({ title: "x", data: { source: "Not A Real Source" } });
    expect(badSource.status).toBe(400);
    expect(badSource.body.error.code).toBe("INVALID_TRAINING_SOURCE");

    const badType = await request(app).post("/v1/implementation/training").set(authed(token))
      .send({ title: "x", data: { type: "Not A Real Type" } });
    expect(badType.status).toBe(400);
    expect(badType.body.error.code).toBe("INVALID_TRAINING_TYPE");

    const badDelivery = await request(app).post("/v1/implementation/training").set(authed(token))
      .send({ title: "x", data: { delivery: "Not A Real Delivery" } });
    expect(badDelivery.status).toBe(400);
    expect(badDelivery.body.error.code).toBe("INVALID_TRAINING_DELIVERY");

    const ok = await request(app).post("/v1/implementation/training").set(authed(token))
      .send({ title: "Lead Auditor course", data: { source: "Manual", type: "Certification Training", delivery: "External training" } });
    expect(ok.status).toBe(201);
  });

  // OD `tpOverdue`/`tpEffStatus` (13944-13945): overdue is derived on read,
  // never a stored status value.
  it("derives Overdue on read without ever persisting it as the stored status", async () => {
    const { token } = await makeTenant("tp3", "TPT3");
    const created = await request(app).post("/v1/implementation/training").set(authed(token))
      .send({ title: "Lapsed item", status: "Planned", data: { due: "2020-01-01" } });
    expect(created.body.data.status).toBe("Planned");
    expect(created.body.data.data.overdue).toBe(true);
    expect(created.body.data.data.effectiveStatus).toBe("Overdue");

    const list = await request(app).get("/v1/implementation/training").set(authed(token));
    const row = list.body.data.find((x: { id: string }) => x.id === created.body.data.id);
    expect(row.status).toBe("Planned");
    expect(row.data.overdue).toBe(true);
    expect(row.data.effectiveStatus).toBe("Overdue");
  });

  // OD `tpCompleteSave` (14173-14179): completedBy is split into a trimmed
  // array, evidence gets its own activity line before the completion line,
  // and a non-"Completed" result always lands on "Completed" regardless of
  // reassessRequired.
  it("records completion with the exact OD status quirk and activity ordering", async () => {
    const { token } = await makeTenant("tp4", "TPT4");
    const created = await request(app).post("/v1/implementation/training").set(authed(token))
      .send({ title: "Lead Auditor course", status: "In Progress", data: { reassessRequired: true } });
    const id = created.body.data.id;

    const completed = await request(app).post(`/v1/implementation/training/${id}/complete`).set(authed(token))
      .send({ completionResult: "Completed", completedBy: " Alice , Bob ,,", evidence: "certificate.pdf", notes: "Passed with distinction" });
    expect(completed.status).toBe(200);
    expect(completed.body.data.status).toBe("Pending Reassessment");
    expect(completed.body.data.data.completedBy).toEqual(["Alice", "Bob"]);
    expect(completed.body.data.data.completionEvidence).toBe("certificate.pdf");

    const events = await request(app).get(`/v1/record-events/training/${id}`).set(authed(token));
    const texts = (events.body.data as { text: string }[]).map((e) => e.text);
    const evidenceIdx = texts.findIndex((t) => t.includes("uploaded completion evidence") || t.toLowerCase().includes("uploaded completion evidence"));
    const recordedIdx = texts.findIndex((t) => t.toLowerCase().includes("recorded completion"));
    expect(evidenceIdx).toBeGreaterThanOrEqual(0);
    expect(recordedIdx).toBeGreaterThan(evidenceIdx);

    // A second, separate item: reassessRequired but a non-"Completed" result
    // still lands on "Completed" (OD quirk), not "Pending Reassessment".
    const created2 = await request(app).post("/v1/implementation/training").set(authed(token))
      .send({ title: "Refresher", status: "In Progress", data: { reassessRequired: true } });
    const id2 = created2.body.data.id;
    const failed = await request(app).post(`/v1/implementation/training/${id2}/complete`).set(authed(token))
      .send({ completionResult: "Failed" });
    expect(failed.body.data.status).toBe("Completed");
  });

  it("refuses completion on an already-closed-out item", async () => {
    const { token } = await makeTenant("tp5", "TPT5");
    const created = await request(app).post("/v1/implementation/training").set(authed(token))
      .send({ title: "x", status: "Completed" });
    const again = await request(app).post(`/v1/implementation/training/${created.body.data.id}/complete`).set(authed(token)).send({});
    expect(again.status).toBe(400);
    expect(again.body.error.code).toBe("TRAINING_ALREADY_CLOSED");
  });

  // OD `tpReassessSave` (14187-14192): "Meets Requirement" closes both sides;
  // any other result reopens the gap and keeps the training pending.
  it("reassessment: Meets Requirement closes the gap and the training plan", async () => {
    const { token, orgId } = await makeTenant("tp6", "TPT6");
    const gap = await seedGap(orgId, "GAP-1");
    const created = await request(app).post("/v1/implementation/training").set(authed(token))
      .send({ title: "ISO 19011 Lead Auditor", status: "Pending Reassessment", data: { source: "Competence Gap", gapId: gap.id } });
    const id = created.body.data.id;

    const bad = await request(app).post(`/v1/implementation/training/${id}/reassess`).set(authed(token))
      .send({ result: "Not A Real Result" });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("INVALID_REASSESS_RESULT");

    const ok = await request(app).post(`/v1/implementation/training/${id}/reassess`).set(authed(token))
      .send({ result: "Meets Requirement" });
    expect(ok.status).toBe(200);
    expect(ok.body.data.training.status).toBe("Closed");
    expect(ok.body.data.training.data.reassessResult).toBe("Meets Requirement");
    expect(ok.body.data.message).toBe("Requirement met — gap & training closed");

    await gap.reload();
    expect(gap.status).toBe("Resolved");
    expect(gap.reassessResult).toBe("Meets Requirement");
    expect(gap.resolvedBy).toBe(created.body.data.code);
  });

  it("reassessment: any other result reopens the gap and keeps the training pending", async () => {
    const { token, orgId } = await makeTenant("tp7", "TPT7");
    const gap = await seedGap(orgId, "GAP-2");
    gap.status = "Planned";
    await gap.save();
    const created = await request(app).post("/v1/implementation/training").set(authed(token))
      .send({ title: "Refresher", status: "Pending Reassessment", data: { source: "Competence Gap", gapId: gap.id } });
    const id = created.body.data.id;

    const res = await request(app).post(`/v1/implementation/training/${id}/reassess`).set(authed(token))
      .send({ result: "Partially Meets" });
    expect(res.body.data.training.status).toBe("Pending Reassessment");
    expect(res.body.data.message).toBe("Reassessment saved — gap remains open");

    await gap.reload();
    expect(gap.status).toBe("Open");
    expect(gap.reassessResult).toBe("Partially Meets");
  });

  // OD `tpSet(id,'Closed')` (14090-14092): closing a gap-linked item cascades
  // the gap to Resolved even without a reassessment ever being recorded.
  it("closing a gap-linked training plan (without a reassessment) cascades the gap to Resolved", async () => {
    const { token, orgId } = await makeTenant("tp8", "TPT8");
    const gap = await seedGap(orgId, "GAP-3");
    const created = await request(app).post("/v1/implementation/training").set(authed(token))
      .send({ title: "Practical assignment", status: "In Progress", data: { source: "Competence Gap", gapId: gap.id } });
    const id = created.body.data.id;

    const closed = await request(app).post(`/v1/implementation/training/${id}/set-status`).set(authed(token))
      .send({ status: "Closed" });
    expect(closed.status).toBe(200);
    expect(closed.body.data.status).toBe("Closed");

    await gap.reload();
    expect(gap.status).toBe("Resolved");
    expect(gap.resolvedBy).toBe(created.body.data.code);

    // Idempotent: closing again does not error and does not re-touch the gap.
    const resolvedDate = gap.resolvedDate;
    const closedAgain = await request(app).post(`/v1/implementation/training/${id}/set-status`).set(authed(token))
      .send({ status: "Closed" });
    expect(closedAgain.status).toBe(200);
    await gap.reload();
    expect(gap.resolvedDate).toBe(resolvedDate);
  });

  it("rejects a set-status value outside Closed/Cancelled", async () => {
    const { token } = await makeTenant("tp9", "TPT9");
    const created = await request(app).post("/v1/implementation/training").set(authed(token)).send({ title: "x" });
    const res = await request(app).post(`/v1/implementation/training/${created.body.data.id}/set-status`).set(authed(token))
      .send({ status: "Draft" });
    expect(res.status).toBe(400);
  });

  // OD `tpSave` create path (14157): a NEW training plan created against an
  // Open gap binds itself onto that gap immediately — the link is not
  // one-directional.
  it("binds a newly-created gap-linked training plan back onto the gap", async () => {
    const { token, orgId } = await makeTenant("tp10", "TPT10");
    const gap = await seedGap(orgId, "GAP-4");
    expect(gap.status).toBe("Open");

    const created = await request(app).post("/v1/implementation/training").set(authed(token))
      .send({ title: "Development action", status: "Planned", data: { source: "Competence Gap", gapId: gap.id } });
    expect(created.status).toBe(201);

    await gap.reload();
    expect(gap.status).toBe("Planned");
    expect(gap.trainingPlanId).toBe(created.body.data.code);
  });
});
