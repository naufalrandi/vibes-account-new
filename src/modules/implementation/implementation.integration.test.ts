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

describe("ISO clause registers (implementation)", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("creates a register entry with an auto code and lists it back", async () => {
    const { token } = await makeTenant("t1", "TEN1");
    const created = await request(app).post("/v1/implementation/context").set(authed(token))
      .send({ title: "New privacy regulation", status: "Monitored", owner: "MS Team", data: { domain: "Regulatory" } });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ module: "context", code: "OCX-0001", title: "New privacy regulation", status: "Monitored" });

    const list = await request(app).get("/v1/implementation/context").set(authed(token));
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].code).toBe("OCX-0001");
    // Second entry auto-increments the code.
    const second = await request(app).post("/v1/implementation/context").set(authed(token)).send({ title: "Second" });
    expect(second.body.data.code).toBe("OCX-0002");
    expect(second.body.data.status).toBe("Open"); // default = first status in the set
  });

  it("derives riskScore/riskLevel for the risks module", async () => {
    const { token } = await makeTenant("t1", "TEN1");
    const created = await request(app).post("/v1/implementation/risks").set(authed(token))
      .send({ title: "Phishing", data: { likelihood: 4, impact: 4, treatment: "Mitigate" } });
    expect(created.body.data.data).toMatchObject({ riskScore: 16, riskLevel: "Major" });
    const updated = await request(app).put(`/v1/implementation/risks/${created.body.data.id}`).set(authed(token))
      .send({ data: { likelihood: 1, impact: 2 } });
    expect(updated.body.data.data).toMatchObject({ riskScore: 2, riskLevel: "Negligible" });
  });

  it("rejects an unknown module and an invalid status", async () => {
    const { token } = await makeTenant("t1", "TEN1");
    expect((await request(app).get("/v1/implementation/not-a-module").set(authed(token))).status).toBe(404);
    const bad = await request(app).post("/v1/implementation/policies").set(authed(token)).send({ title: "P", status: "Bogus" });
    expect(bad.status).toBe(400);
    // A valid deep-module status is accepted.
    const ok = await request(app).post("/v1/implementation/policies").set(authed(token)).send({ title: "Security Policy", status: "Published" });
    expect(ok.status).toBe(201);
  });

  it("scopes register entries per tenant", async () => {
    const a = await makeTenant("t1", "TEN1");
    const b = await makeTenant("t2", "TEN2");
    const created = await request(app).post("/v1/implementation/risks").set(authed(a.token)).send({ title: "A risk", data: { likelihood: 3, impact: 3 } });
    const id = created.body.data.id;
    expect((await request(app).get("/v1/implementation/risks").set(authed(b.token))).body.data).toHaveLength(0);
    // B cannot edit or delete A's entry.
    expect((await request(app).put(`/v1/implementation/risks/${id}`).set(authed(b.token)).send({ title: "x" })).status).toBe(403);
    expect((await request(app).delete(`/v1/implementation/risks/${id}`).set(authed(b.token))).status).toBe(403);
    // A can delete its own.
    expect((await request(app).delete(`/v1/implementation/risks/${id}`).set(authed(a.token))).status).toBe(200);
    expect((await request(app).get("/v1/implementation/risks").set(authed(a.token))).body.data).toHaveLength(0);
  });

  it("requires the ms action grants", async () => {
    const noGrant = await makeTenant("t3", "TEN3", []);
    expect((await request(app).get("/v1/implementation/risks").set(authed(noGrant.token))).status).toBe(403);
    const readonly = await makeTenant("t4", "TEN4", [ACTIONS.MS_READ]);
    expect((await request(app).get("/v1/implementation/risks").set(authed(readonly.token))).status).toBe(200);
    expect((await request(app).post("/v1/implementation/risks").set(authed(readonly.token)).send({ title: "x" })).status).toBe(403);
  });

  // OD `cdSave`: a published controlled document is never overwritten — editing
  // it forks a new Draft at the next version and supersedes the original, so the
  // approved text stays intact.
  it("forks a new draft version when a published document is edited", async () => {
    const { token } = await makeTenant("t1", "TEN1");
    const created = await request(app).post("/v1/implementation/documents").set(authed(token))
      .send({ title: "Access Control Policy", status: "Draft", data: { version: "1.0", content: "v1 text" } });
    const id = created.body.data.id;

    // Publish it, then edit the published text.
    await request(app).put(`/v1/implementation/documents/${id}`).set(authed(token)).send({ status: "Published" });
    const edited = await request(app).put(`/v1/implementation/documents/${id}`).set(authed(token))
      .send({ data: { content: "v2 text" } });

    // The response is the NEW draft, not the original record.
    expect(edited.status).toBe(200);
    expect(edited.body.data.id).not.toBe(id);
    expect(edited.body.data.status).toBe("Draft");
    expect(edited.body.data.data.version).toBe("1.1");
    expect(edited.body.data.data.content).toBe("v2 text");
    expect(edited.body.data.data.supersedes).toBe(id);

    // The original is superseded and still carries its approved text.
    const list = await request(app).get("/v1/implementation/documents").set(authed(token));
    const original = list.body.data.find((r: { id: string }) => r.id === id);
    expect(original.status).toBe("Superseded");
    expect(original.data.content).toBe("v1 text");
    expect(original.data.supersededBy).toBe(edited.body.data.id);
  });

  it("does not fork on a pure status change, or while still a draft", async () => {
    const { token } = await makeTenant("t1", "TEN1");
    const created = await request(app).post("/v1/implementation/documents").set(authed(token))
      .send({ title: "Backup Procedure", status: "Draft", data: { version: "1.0" } });
    const id = created.body.data.id;

    // Editing a Draft edits in place.
    const draftEdit = await request(app).put(`/v1/implementation/documents/${id}`).set(authed(token))
      .send({ data: { version: "1.0", content: "still draft" } });
    expect(draftEdit.body.data.id).toBe(id);

    // Archiving a published doc is a status transition, not an edit.
    await request(app).put(`/v1/implementation/documents/${id}`).set(authed(token)).send({ status: "Published" });
    const archived = await request(app).put(`/v1/implementation/documents/${id}`).set(authed(token)).send({ status: "Archived" });
    expect(archived.body.data.id).toBe(id);
    expect(archived.body.data.status).toBe("Archived");
  });

  // OD `ncClose` blocks closure until the corrective action is verified effective.
  it("refuses to close a nonconformity until effectiveness is verified", async () => {
    const { token } = await makeTenant("t1", "TEN1");
    const created = await request(app).post("/v1/implementation/nonconformities").set(authed(token))
      .send({ title: "Missing access review", status: "CAP Planned", data: { severity: "High" } });
    const id = created.body.data.id;

    const blocked = await request(app).put(`/v1/implementation/nonconformities/${id}`).set(authed(token))
      .send({ status: "Closed" });
    expect(blocked.status).toBe(400);
    expect(blocked.body.error.code).toBe("EFFECTIVENESS_NOT_VERIFIED");

    // "Not effective" is an assessment, but not a passing one.
    const stillBlocked = await request(app).put(`/v1/implementation/nonconformities/${id}`).set(authed(token))
      .send({ status: "Closed", data: { effectiveness: "Not effective" } });
    expect(stillBlocked.status).toBe(400);

    // Verified effective — closure now allowed.
    const closed = await request(app).put(`/v1/implementation/nonconformities/${id}`).set(authed(token))
      .send({ status: "Closed", data: { effectiveness: "Effective", effectivenessDate: "2026-07-30" } });
    expect(closed.status).toBe(200);
    expect(closed.body.data.status).toBe("Closed");
  });

  it("closes when effectiveness was verified in an earlier save", async () => {
    const { token } = await makeTenant("t1", "TEN1");
    const created = await request(app).post("/v1/implementation/nonconformities").set(authed(token))
      .send({ title: "Late calibration", status: "CAP Planned" });
    const id = created.body.data.id;

    await request(app).put(`/v1/implementation/nonconformities/${id}`).set(authed(token))
      .send({ data: { effectiveness: "Effective" } });
    const closed = await request(app).put(`/v1/implementation/nonconformities/${id}`).set(authed(token))
      .send({ status: "Closed" });
    expect(closed.status).toBe(200);
  });

  // OD's Training Plan closes the loop back onto the competence gap that
  // prompted the training; the two used to have no relationship at all.
  it("closes the linked competence gap when training completes with Meets Requirement", async () => {
    const { token, orgId } = await makeTenant("t1", "TEN1");
    const gap = await seedGap(orgId, "GAP-0001");

    const created = await request(app).post("/v1/implementation/training").set(authed(token))
      .send({ title: "ISO 19011 Lead Auditor", status: "Planned", data: { gapId: gap.id } });
    const id = created.body.data.id;

    await request(app).put(`/v1/implementation/training/${id}`).set(authed(token))
      .send({ status: "Completed", data: { gapId: gap.id, outcome: "Meets Requirement" } });

    await gap.reload();
    expect(gap.status).toBe("Closed");
    expect(gap.trainingDone).toBe(true);
    expect(gap.resolvedDate).toBeTruthy();
  });

  it("leaves the gap open when the training outcome is below requirement", async () => {
    const { token, orgId } = await makeTenant("t1", "TEN1");
    const gap = await seedGap(orgId, "GAP-0002");
    const before = gap.status;

    const created = await request(app).post("/v1/implementation/training").set(authed(token))
      .send({ title: "Refresher", status: "Planned", data: { gapId: gap.id } });
    await request(app).put(`/v1/implementation/training/${created.body.data.id}`).set(authed(token))
      .send({ status: "Completed", data: { gapId: gap.id, outcome: "Below Requirement" } });

    await gap.reload();
    expect(gap.status).toBe(before);
    expect(gap.trainingDone).toBe(false);
  });

  // Marking documents `approvable` on the client is only half the wiring — the
  // backend has to list the module as governed, or the Approval button 400s.
  it("routes a controlled document through the approval engine", async () => {
    const { token, orgId } = await makeTenant("t1", "TEN1", [...MS, ACTIONS.APPROVAL_READ, ACTIONS.APPROVAL_MANAGE, ACTIONS.APPROVAL_APPROVE]);
    const me = await User.findOne({ where: { orgId } });
    await request(app).put(`/v1/approvals/pools/${me!.id}`).set(authed(token)).send({ isMST: true, isTM: true, tmFinal: true });

    const created = await request(app).post("/v1/implementation/documents").set(authed(token))
      .send({ title: "Access Control Policy", status: "Draft", data: { version: "1.0" } });
    const id = created.body.data.id;

    const submitted = await request(app).post(`/v1/approvals/records/documents/${id}/submit`).set(authed(token)).send({});
    expect(submitted.status).toBe(200);
    expect(submitted.body.data.status).not.toBe("Draft");
  });

  // OD `conRoute`: classifying a concern *creates* the downstream record and
  // cross-links both ways. Storing the dropdown value alone is a dead end.
  it("routes a concern into a real nonconformity and cross-links them", async () => {
    const { token } = await makeTenant("tcon1", "TCON1");
    const c = await request(app).post("/v1/implementation/concerns").set(authed(token))
      .send({ title: "Unlabelled reagent on bench", data: { description: "Found during walkthrough", site: "Plant A" } });
    expect(c.status).toBe(201);

    const routed = await request(app).post(`/v1/implementation/concerns/${c.body.data.id}/route`).set(authed(token))
      .send({ reviewer: "QA Lead", classification: "Nonconformity", reviewNotes: "Confirmed on site" });
    expect(routed.status).toBe(201);

    const { concern, created } = routed.body.data;
    expect(concern.status).toBe("Routed");
    expect(created.module).toBe("nonconformities");
    expect(created.code).toMatch(/^NCR-/);
    expect(created.title).toBe("Unlabelled reagent on bench");
    expect(created.data.sourceConcernId).toBe(concern.id);
    expect(created.data.description).toBe("Found during walkthrough");
    expect(concern.data.routedRecordId).toBe(created.id);
  });

  it("requires a closure reason when closing rather than routing, and refuses double review", async () => {
    const { token } = await makeTenant("tcon2", "TCON2");
    const c = await request(app).post("/v1/implementation/concerns").set(authed(token)).send({ title: "Duplicate report" });
    const id = c.body.data.id;

    const noReason = await request(app).post(`/v1/implementation/concerns/${id}/route`).set(authed(token))
      .send({ reviewer: "QA Lead", classification: "No Action Required", reviewNotes: "Checked" });
    expect(noReason.status).toBe(400);
    expect(noReason.body.error.code).toBe("CLOSURE_REASON_REQUIRED");

    const closed = await request(app).post(`/v1/implementation/concerns/${id}/route`).set(authed(token))
      .send({ reviewer: "QA Lead", classification: "No Action Required", reviewNotes: "Checked", closureReason: "Already handled" });
    expect(closed.status).toBe(201);
    expect(closed.body.data.concern.status).toBe("Closed");
    expect(closed.body.data.created).toBeNull();

    const again = await request(app).post(`/v1/implementation/concerns/${id}/route`).set(authed(token))
      .send({ reviewer: "QA Lead", classification: "Incident", reviewNotes: "x" });
    expect(again.status).toBe(400);
    expect(again.body.error.code).toBe("CONCERN_ALREADY_ROUTED");
  });

  it("does not re-close a competence gap when an already-completed training is edited again", async () => {
    const { token, orgId } = await makeTenant("ttr2", "TTR2");
    const gap = await seedGap(orgId, "GAP-RE1");
    const tr = await request(app).post("/v1/implementation/training").set(authed(token))
      .send({ title: "Auditor refresher", data: { gapId: gap.id, outcome: "Meets Requirement" } });

    await request(app).put(`/v1/implementation/training/${tr.body.data.id}`).set(authed(token)).send({ status: "Completed" });
    await gap.reload();
    expect(gap.status).toBe("Closed");
    const firstResolved = gap.resolvedDate;

    // An unrelated edit while still Completed must not touch the gap again.
    gap.resolvedDate = "2020-01-01";
    await gap.save();
    await request(app).put(`/v1/implementation/training/${tr.body.data.id}`).set(authed(token))
      .send({ title: "Auditor refresher (rev B)" });
    await gap.reload();
    expect(gap.resolvedDate).toBe("2020-01-01");
    expect(firstResolved).not.toBe("2020-01-01");
  });

  // OD `awTopicActivate`: evidence before activation.
  it("refuses to activate an awareness topic with no material, and allows it once one exists", async () => {
    const { token } = await makeTenant("taw", "TAW1");
    const t = await request(app).post("/v1/implementation/awareness-topics").set(authed(token))
      .send({ title: "Phishing awareness", data: { category: "Security" } });
    expect(t.status).toBe(201);
    expect(t.body.data.code).toMatch(/^AWT-/);

    const blocked = await request(app).put(`/v1/implementation/awareness-topics/${t.body.data.id}`)
      .set(authed(token)).send({ status: "Active" });
    expect(blocked.status).toBe(400);
    expect(blocked.body.error.code).toBe("MATERIAL_REQUIRED");

    const ok = await request(app).put(`/v1/implementation/awareness-topics/${t.body.data.id}`)
      .set(authed(token)).send({ status: "Active", data: { materials: [{ title: "Deck", fileName: "phishing.pdf", version: "1.0" }] } });
    expect(ok.status).toBe(200);
    expect(ok.body.data.status).toBe("Active");
  });

  // OD `ocArchive`: justification required, and no archiving over an open risk.
  it("requires justification to archive a context issue and blocks it while a linked risk is open", async () => {
    const { token } = await makeTenant("tocx", "TOCX");
    const risk = await request(app).post("/v1/implementation/risks").set(authed(token))
      .send({ title: "Supplier failure", status: "Assessed" });
    const issue = await request(app).post("/v1/implementation/context").set(authed(token))
      .send({ title: "Single-source supplier", status: "Monitored", data: { raisedRiskId: risk.body.data.id } });

    const noReason = await request(app).put(`/v1/implementation/context/${issue.body.data.id}`)
      .set(authed(token)).send({ status: "Archived" });
    expect(noReason.status).toBe(400);
    expect(noReason.body.error.code).toBe("JUSTIFICATION_REQUIRED");

    const openRisk = await request(app).put(`/v1/implementation/context/${issue.body.data.id}`)
      .set(authed(token)).send({ status: "Archived", data: { raisedRiskId: risk.body.data.id, justification: "No longer relevant" } });
    expect(openRisk.status).toBe(400);
    expect(openRisk.body.error.code).toBe("LINKED_RISK_OPEN");

    // Close the risk out, and the issue archives.
    await request(app).put(`/v1/implementation/risks/${risk.body.data.id}`).set(authed(token)).send({ status: "Monitored" });
    const done = await request(app).put(`/v1/implementation/context/${issue.body.data.id}`)
      .set(authed(token)).send({ status: "Archived", data: { raisedRiskId: risk.body.data.id, justification: "Risk now monitored" } });
    expect(done.status).toBe(200);
    expect(done.body.data.status).toBe("Archived");
  });
});
