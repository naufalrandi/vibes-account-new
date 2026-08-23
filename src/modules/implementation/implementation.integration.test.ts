import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { createApp } from "../../app";
import { CompetenceAssignment, CompetenceGap, CompetenceRole, initModels, Organization, User, Role } from "../../db/models";
import { hashPassword } from "../../lib/password";
import { resetDb, grantActions } from "../../../test/helpers";
import { ACTIONS } from "../iam/actions.catalog";
import { MS_MODULES } from "./registry";

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
    // OD `ocFweCode`/`ocNewId` (index.html:8119–8120): the context register's
    // prefix is the "Organizational Context" FWE element's own code — no
    // element is seeded in this test's org, so it falls back to "FWE-001" —
    // and the numeric suffix is NOT zero-padded, unlike every other register.
    expect(created.body.data).toMatchObject({ module: "context", code: "FWE-001-1", title: "New privacy regulation", status: "Monitored" });

    const list = await request(app).get("/v1/implementation/context").set(authed(token));
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].code).toBe("FWE-001-1");
    // Second entry auto-increments the code.
    const second = await request(app).post("/v1/implementation/context").set(authed(token)).send({ title: "Second" });
    expect(second.body.data.code).toBe("FWE-001-2");
    expect(second.body.data.status).toBe("Open"); // default = first status in the set
  });

  it("derives riskScore/riskLevel for the risks module", async () => {
    const { token } = await makeTenant("t1", "TEN1");
    const created = await request(app).post("/v1/implementation/risks").set(authed(token))
      .send({ title: "Phishing", data: { likelihood: 4, impact: 4 } });
    expect(created.body.data.code).toMatch(/^RISK-/);
    expect(created.body.data.data).toMatchObject({ riskScore: 16, riskLevel: "Critical", level: 16, band: "Critical" });
    const updated = await request(app).put(`/v1/implementation/risks/${created.body.data.id}`).set(authed(token))
      .send({ data: { likelihood: 1, impact: 2 } });
    expect(updated.body.data.data).toMatchObject({ riskScore: 2, riskLevel: "Low", level: 2, band: "Low" });
  });

  // OD `riskArchive` (index.html:8135–8137): a risk must reach "Monitored"
  // before it can be archived, and an already-archived risk refuses a second
  // archive rather than silently no-op-ing.
  it("only allows archiving a risk once it reaches Monitored, and refuses to re-archive", async () => {
    const { token } = await makeTenant("t1", "TEN1");
    const created = await request(app).post("/v1/implementation/risks").set(authed(token))
      .send({ title: "Unpatched server", status: "Assigned", data: { likelihood: 3, impact: 3 } });
    const id = created.body.data.id;

    const tooEarly = await request(app).put(`/v1/implementation/risks/${id}`).set(authed(token))
      .send({ status: "Archived" });
    expect(tooEarly.status).toBe(400);
    expect(tooEarly.body.error.message).toBe('Risk must reach "Monitored" before it can be archived.');

    await request(app).put(`/v1/implementation/risks/${id}`).set(authed(token)).send({ status: "Assessed" });
    await request(app).put(`/v1/implementation/risks/${id}`).set(authed(token)).send({ status: "Treated" });
    await request(app).put(`/v1/implementation/risks/${id}`).set(authed(token)).send({ status: "Monitored" });

    const archived = await request(app).put(`/v1/implementation/risks/${id}`).set(authed(token))
      .send({ status: "Archived" });
    expect(archived.status).toBe(200);
    expect(archived.body.data.status).toBe("Archived");

    const again = await request(app).put(`/v1/implementation/risks/${id}`).set(authed(token))
      .send({ status: "Archived" });
    expect(again.status).toBe(400);
    expect(again.body.error.code).toBe("RISK_ALREADY_ARCHIVED");
    expect(again.body.error.message).toBe("Risk already archived");
  });

  // P-6.1 (D-1): the risk lifecycle test above already proves a risk can be
  // archived end-to-end over the real API, but `assertStatus` has an
  // unconditional `status !== "Archived"` bypass (predates this fix) that
  // would let it pass that test even with "Archived" missing from the risks
  // registry entirely — which is exactly the state that broke
  // registryParity.test.ts (FE listed "Archived", BE's MS_MODULES.risks did
  // not). This pins the registry itself, independent of that bypass.
  it("lists Archived as a real risks status, last, so Unassigned stays the create default", () => {
    expect(MS_MODULES.risks.statuses).toEqual([
      "Unassigned", "Assigned", "RTP Draft", "Pending Approval", "Pending TM Approval",
      "In Treatment", "Assessed", "Treated", "Monitored", "Archived",
    ]);
    expect(MS_MODULES.risks.statuses[0]).toBe("Unassigned");
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

  // Controlled-document form data satisfying the default cdSettings save gates.
  const cdData = (extra: Record<string, unknown> = {}) => ({
    type: "Procedure", approver: "Jennifer Walters", changeSummary: "Initial issue", ...extra,
  });

  // OD `cdSave` (12921–12925): a published controlled document is never
  // overwritten — editing it forks a new Draft at the next version in the same
  // lineage while the original STAYS Published (superseding happens only when
  // the new version itself is published — see approval.integration.test.ts).
  it("forks a new draft version when a published document is edited", async () => {
    const { token } = await makeTenant("t1", "TEN1");
    const created = await request(app).post("/v1/implementation/documents").set(authed(token))
      .send({ title: "Access Control Policy", status: "Draft", owner: "IT Lead", data: cdData({ version: "1.0", content: "v1 text" }) });
    const id = created.body.data.id;

    // Publish it, then edit the published text.
    await request(app).put(`/v1/implementation/documents/${id}`).set(authed(token)).send({ status: "Published" });
    const edited = await request(app).put(`/v1/implementation/documents/${id}`).set(authed(token))
      .send({ data: cdData({ content: "v2 text", changeSummary: "Clarify scope" }) });

    // The response is the NEW draft, not the original record.
    expect(edited.status).toBe(200);
    expect(edited.body.data.id).not.toBe(id);
    expect(edited.body.data.status).toBe("Draft");
    expect(edited.body.data.data.version).toBe("1.1");
    expect(edited.body.data.data.content).toBe("v2 text");
    expect(edited.body.data.data.lineageId).toBe(id);
    expect(edited.body.data.data.prevVersionId).toBe(id);
    // The fresh draft carries no approval stamps of its own.
    expect(edited.body.data.data.approvedBy).toBe("");
    expect(edited.body.data.data.publishedBy).toBe("");

    // The original STAYS Published (live during the revision cycle) with its text intact.
    const list = await request(app).get("/v1/implementation/documents").set(authed(token));
    const original = list.body.data.find((r: { id: string }) => r.id === id);
    expect(original.status).toBe("Published");
    expect(original.data.content).toBe("v1 text");
    expect(original.data.supersededBy).toBeUndefined();
  });

  it("does not fork on a pure status change, while still a draft, or when allowEditPublished is on", async () => {
    const { token } = await makeTenant("t1", "TEN1");
    const created = await request(app).post("/v1/implementation/documents").set(authed(token))
      .send({ title: "Backup Procedure", status: "Draft", owner: "IT Lead", data: cdData({ version: "1.0" }) });
    const id = created.body.data.id;

    // Editing a Draft edits in place.
    const draftEdit = await request(app).put(`/v1/implementation/documents/${id}`).set(authed(token))
      .send({ data: cdData({ version: "1.0", content: "still draft" }) });
    expect(draftEdit.body.data.id).toBe(id);

    // Archiving a published doc is a status transition, not an edit.
    await request(app).put(`/v1/implementation/documents/${id}`).set(authed(token)).send({ status: "Published" });
    const archived = await request(app).put(`/v1/implementation/documents/${id}`).set(authed(token)).send({ status: "Archived" });
    expect(archived.body.data.id).toBe(id);
    expect(archived.body.data.status).toBe("Archived");

    // With allowEditPublished on (OD cdSettings), a published doc edits in place.
    await request(app).put(`/v1/implementation/documents/${id}`).set(authed(token)).send({ status: "Published" });
    await request(app).put("/v1/implementation/documents/settings").set(authed(token)).send({ allowEditPublished: true });
    const inPlace = await request(app).put(`/v1/implementation/documents/${id}`).set(authed(token))
      .send({ data: cdData({ version: "1.0", content: "edited in place" }) });
    expect(inPlace.body.data.id).toBe(id);
    expect(inPlace.body.data.data.content).toBe("edited in place");
  });

  // OD `cdNewId` (12730): TYPECODE[-FWCODE]-NNNN with one per-tenant number
  // sequence across all document types; external documents are EXT-STD-NNNN.
  it("assigns cdNewId-style codes, sequenced per organization", async () => {
    const a = await makeTenant("t1", "TEN1");
    const b = await makeTenant("t2", "TEN2");
    const mk = (token: string, data: Record<string, unknown>, frameworks?: string[]) =>
      request(app).post("/v1/implementation/documents").set(authed(token))
        .send({ title: "Doc", status: "Draft", owner: "IT Lead", data: cdData(data), frameworks });

    expect((await mk(a.token, { type: "Policy" }, ["ISO 9001:2015"])).body.data.code).toBe("POL-QMS-0001");
    expect((await mk(a.token, { type: "Work Instruction" })).body.data.code).toBe("WI-0002");
    expect((await mk(a.token, { type: "External Document" }, ["ISO/IEC 27001:2022"])).body.data.code).toBe("EXT-STD-0003");
    // Unknown type falls back to DOC; another org starts its own sequence at 0001.
    expect((await mk(a.token, { type: "Something Else" })).body.data.code).toBe("DOC-0004");
    expect((await mk(b.token, { type: "Policy" })).body.data.code).toBe("POL-0001");
  });

  // OD `cdSave` gates (12905–12909): the org's cdSettings decide the mandatory metadata.
  it("enforces the document-control save gates and exposes the settings endpoint", async () => {
    const { token } = await makeTenant("t1", "TEN1");
    // Defaults: owner + approver + change summary all required.
    const missing = await request(app).post("/v1/implementation/documents").set(authed(token))
      .send({ title: "No approver", status: "Draft", owner: "IT Lead", data: { type: "Procedure", changeSummary: "x" } });
    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe("DOC_APPROVER_REQUIRED");

    const settings = await request(app).get("/v1/implementation/documents/settings").set(authed(token));
    expect(settings.body.data).toMatchObject({ requireApprover: true, requireChange: true, allowEditPublished: false });

    await request(app).put("/v1/implementation/documents/settings").set(authed(token))
      .send({ requireApprover: false, requireChange: false, requireOwner: false });
    const relaxed = await request(app).post("/v1/implementation/documents").set(authed(token))
      .send({ title: "No approver", status: "Draft", data: { type: "Procedure" } });
    expect(relaxed.status).toBe(201);
    // nextReview derives from effective date + review frequency on save.
    const derived = await request(app).post("/v1/implementation/documents").set(authed(token))
      .send({ title: "Derived", status: "Draft", data: { type: "Procedure", effectiveDate: "2026-06-01T00:00:00.000Z", reviewFreq: "Quarterly" } });
    expect(derived.body.data.data.nextReview).toBe(new Date("2026-09-01T00:00:00.000Z").toISOString());
  });

  // A minimal CAP payload for the tests below — RCA/corrective action/PIC/due
  // are what a real `capForm` submission always carries; each test overrides
  // just the implementation/effectiveness fields it's exercising. Mirrors the
  // real client (`CapEditorModal.tsx`'s `submit`): the CAP fields are nested
  // under `data.cap`, not flattened onto `data` — `applyCapSideEffects`
  // (implementation.service.ts) reads `data.cap` and early-returns when it's
  // absent, and itself derives the top-level `pic`/`due`/`capStatus`.
  const capData = (extra: Record<string, unknown> = {}) => ({
    cap: {
      rca: "Checklist did not require the field", correctiveAction: "Add the field to the checklist",
      pic: "QA Lead", due: "2026-07-01", implementationStatus: "Pending Effectiveness Check", ...extra,
    },
  });

  // OD `ncClose` (11460) blocks closure while the CAP's own effectiveness
  // check is required and unresolved.
  it("refuses to close a nonconformity while its CAP's effectiveness check is required and unresolved", async () => {
    const { token } = await makeTenant("t1", "TEN1");
    const created = await request(app).post("/v1/implementation/nonconformities").set(authed(token))
      .send({ title: "Missing access review", data: { severity: "High" } });
    const id = created.body.data.id;
    const put = (data: Record<string, unknown>, status?: string) =>
      request(app).put(`/v1/implementation/nonconformities/${id}`).set(authed(token)).send({ status, data });

    await put(capData({ effRequired: true, effResult: "Not Checked" }));
    const blocked = await put(capData({ effRequired: true, effResult: "Not Checked" }), "Closed");
    expect(blocked.status).toBe(400);
    expect(blocked.body.error.code).toBe("EFFECTIVENESS_NOT_VERIFIED");

    // "Not Effective" is an assessment, but not a passing one.
    const stillBlocked = await put(capData({ effRequired: true, effResult: "Not Effective" }), "Closed");
    expect(stillBlocked.status).toBe(400);
    expect(stillBlocked.body.error.code).toBe("EFFECTIVENESS_NOT_VERIFIED");

    // Verified effective — closure now allowed.
    const closed = await put(capData({ effRequired: true, effResult: "Effective" }), "Closed");
    expect(closed.status).toBe(200);
    expect(closed.body.data.status).toBe("Closed");
  });

  it("closes when the CAP's effectiveness was verified in an earlier save", async () => {
    const { token } = await makeTenant("t1", "TEN1");
    const created = await request(app).post("/v1/implementation/nonconformities").set(authed(token))
      .send({ title: "Late calibration" });
    const id = created.body.data.id;

    await request(app).put(`/v1/implementation/nonconformities/${id}`).set(authed(token))
      .send({ data: capData({ effRequired: true, effResult: "Effective" }) });
    // A later save with no `data` at all falls back to the stored CAP.
    const closed = await request(app).put(`/v1/implementation/nonconformities/${id}`).set(authed(token))
      .send({ status: "Closed" });
    expect(closed.status).toBe(200);
  });

  // The task's conditional-closure design: `effRequired: false` opts the CAP
  // out of the effectiveness gate entirely.
  it("allows closing when the CAP marks its effectiveness check as not required", async () => {
    const { token } = await makeTenant("t1", "TEN1");
    const created = await request(app).post("/v1/implementation/nonconformities").set(authed(token))
      .send({ title: "Minor labeling gap" });
    const id = created.body.data.id;

    await request(app).put(`/v1/implementation/nonconformities/${id}`).set(authed(token))
      .send({ data: capData({ implementationStatus: "Implemented", effRequired: false, effResult: "Not Checked" }) });
    const closed = await request(app).put(`/v1/implementation/nonconformities/${id}`).set(authed(token))
      .send({ status: "Closed" });
    expect(closed.status).toBe(200);
    expect(closed.body.data.status).toBe("Closed");
  });

  // OD `ncClose`: `n.cap && n.cap.effRequired && …` short-circuits when there
  // is no CAP at all — nothing to gate on.
  it("allows closing when there is no CAP yet to gate on", async () => {
    const { token } = await makeTenant("t1", "TEN1");
    const created = await request(app).post("/v1/implementation/nonconformities").set(authed(token))
      .send({ title: "Trivial admin NC" });
    const closed = await request(app).put(`/v1/implementation/nonconformities/${created.body.data.id}`)
      .set(authed(token)).send({ status: "Closed" });
    expect(closed.status).toBe(200);
    expect(closed.body.data.status).toBe("Closed");
  });

  // OD `capSave` (11524): the CAP's own implementation status drives the NC's
  // status and copies PIC/Due up — but only when the CAP status actually
  // changes, and a CAP-driven Closed still has to pass the effectiveness
  // gate so the two lifecycles can never contradict each other.
  it("derives the NC status from the CAP's implementation status and copies PIC/Due", async () => {
    const { token } = await makeTenant("t1", "TEN1");
    const created = await request(app).post("/v1/implementation/nonconformities").set(authed(token))
      .send({ title: "Undocumented change" });
    const id = created.body.data.id;
    const put = (data: Record<string, unknown>) =>
      request(app).put(`/v1/implementation/nonconformities/${id}`).set(authed(token)).send({ data });

    const planned = await put(capData({ pic: "Jane", due: "2026-08-01", implementationStatus: "Planned", effRequired: true, effResult: "Not Checked" }));
    expect(planned.status).toBe(200);
    expect(planned.body.data.status).toBe("CAP Planned");
    expect(planned.body.data.data.pic).toBe("Jane");
    expect(planned.body.data.data.due).toBe("2026-08-01");
    expect(planned.body.data.data.capStatus).toBe("Planned");
    const capCode = planned.body.data.data.cap.id;
    expect(capCode).toMatch(/^CAP-\d{4}$/);

    // Re-saving the CAP with the same implementation status is not a
    // transition — the NC status is left exactly as a human set it.
    const untouched = await put({ ...planned.body.data.data, cap: { ...planned.body.data.data.cap, resources: "Extra training" } });
    expect(untouched.body.data.status).toBe("CAP Planned");

    const inProgress = await put({ ...untouched.body.data.data, cap: { ...untouched.body.data.data.cap, implementationStatus: "In Progress" } });
    expect(inProgress.body.data.status).toBe("In Progress");
    expect(inProgress.body.data.data.cap.id).toBe(capCode); // the CAP keeps its own code across saves

    const effective = await put({ ...inProgress.body.data.data, cap: { ...inProgress.body.data.data.cap, implementationStatus: "Effective", effResult: "Effective" } });
    expect(effective.body.data.status).toBe("Pending Effectiveness Check");

    // A CAP-driven close still has to pass the effectiveness gate.
    const blockedClose = await put({ ...effective.body.data.data, cap: { ...effective.body.data.data.cap, implementationStatus: "Closed", effResult: "Not Effective" } });
    expect(blockedClose.status).toBe(400);
    expect(blockedClose.body.error.code).toBe("EFFECTIVENESS_NOT_VERIFIED");

    const closed = await put({ ...effective.body.data.data, cap: { ...effective.body.data.data.cap, implementationStatus: "Closed", effResult: "Effective" } });
    expect(closed.status).toBe(200);
    expect(closed.body.data.status).toBe("Closed");
  });

  it("assigns CAP codes their own per-org sequence, independent of NC codes", async () => {
    const { token } = await makeTenant("t1", "TEN1");
    const a = await request(app).post("/v1/implementation/nonconformities").set(authed(token)).send({ title: "NC A" });
    const b = await request(app).post("/v1/implementation/nonconformities").set(authed(token)).send({ title: "NC B" });

    const capA = await request(app).put(`/v1/implementation/nonconformities/${a.body.data.id}`).set(authed(token))
      .send({ data: capData() });
    const capB = await request(app).put(`/v1/implementation/nonconformities/${b.body.data.id}`).set(authed(token))
      .send({ data: capData() });
    expect(capA.body.data.data.cap.id).toBe("CAP-0001");
    expect(capB.body.data.data.cap.id).toBe("CAP-0002");
  });

  // OD `conForm`: the reporter is stamped from the actor who submitted the
  // concern (`ocActor()`), not a typed field.
  it("stamps a concern's reporter automatically at creation", async () => {
    const { token } = await makeTenant("trep", "TREP");
    const created = await request(app).post("/v1/implementation/concerns").set(authed(token))
      .send({ title: "Unlabelled reagent on bench" });
    expect(created.status).toBe(201);
    expect(created.body.data.data.reportedBy).toBe("T"); // makeTenant seeds fullName "T"
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
    expect(gap.status).toBe("Resolved");
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

  // Controlled documents use OD's bespoke 3-step flow (submit → review decision
  // → explicit publish) rather than the multi-gate engine — no pool membership
  // is needed to submit, only an assigned approver. The full flow is covered in
  // approval.integration.test.ts ("controlled documents workflow").
  it("submits a controlled document without requiring approval-pool membership", async () => {
    const { token } = await makeTenant("t1", "TEN1", [...MS, ACTIONS.APPROVAL_READ, ACTIONS.APPROVAL_MANAGE, ACTIONS.APPROVAL_APPROVE]);
    const created = await request(app).post("/v1/implementation/documents").set(authed(token))
      .send({ title: "Access Control Policy", status: "Draft", owner: "IT Lead", data: cdData({ version: "1.0" }) });
    const id = created.body.data.id;

    const submitted = await request(app).post(`/v1/approvals/records/documents/${id}/submit`).set(authed(token)).send({});
    expect(submitted.status).toBe(200);
    expect(submitted.body.data.status).toBe("Under Review");
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
    expect(created.code).toMatch(/^NC-/);
    expect(created.title).toBe("Unlabelled reagent on bench");
    expect(created.data.sourceConcernId).toBe(concern.id);
    expect(created.data.description).toBe("Found during walkthrough");
    expect(concern.data.routedRecordId).toBe(created.id);
    // OD `conRoute` (11365): a concern routed to Nonconformity starts as a
    // "Process Nonconformity" with no CAP yet — the reviewer sets the real
    // category via `ncForm`, and PIC/Due come from the CAP once one exists.
    expect(created.data.category).toBe("Process Nonconformity");
    expect(created.data.cap).toBeNull();
    expect(created.data.pic).toBe("");
    expect(created.data.due).toBe("");
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
    expect(gap.status).toBe("Resolved");
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
    expect(done.body.data.data.archiveJustification).toBe("Risk now monitored");
    expect(done.body.data.data.archivedBy).toBeTruthy();
    expect(done.body.data.data.archivedAt).toBeTruthy();
  });

  // OD `ocDismiss`: only an Open issue can be dismissed, and `ocArchiveDirect`:
  // only a Monitored issue can be archived directly — mirrors the OD UI's own
  // status-dependent action gating, enforced server-side.
  it("gates Dismiss to Open issues and stamps the dismissal justification", async () => {
    const { token } = await makeTenant("tocx2", "TOCX2");
    const issue = await request(app).post("/v1/implementation/context").set(authed(token))
      .send({ title: "Unclear escalation path", status: "Monitored" });

    const wrongState = await request(app).put(`/v1/implementation/context/${issue.body.data.id}`)
      .set(authed(token)).send({ status: "Dismissed", data: { dismissJustification: "Not needed" } });
    expect(wrongState.status).toBe(400);
    expect(wrongState.body.error.code).toBe("INVALID_TRANSITION");

    const openIssue = await request(app).post("/v1/implementation/context").set(authed(token))
      .send({ title: "Ambiguous ownership note" });
    const dismissed = await request(app).put(`/v1/implementation/context/${openIssue.body.data.id}`)
      .set(authed(token)).send({ status: "Dismissed", data: { dismissJustification: "Reviewed — no monitoring needed" } });
    expect(dismissed.status).toBe(200);
    expect(dismissed.body.data.status).toBe("Dismissed");
    expect(dismissed.body.data.data.dismissJustification).toBe("Reviewed — no monitoring needed");
    expect(dismissed.body.data.data.dismissedBy).toBeTruthy();
    expect(dismissed.body.data.data.dismissedAt).toBeTruthy();
  });
});
