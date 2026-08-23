import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import { initModels, Organization, User, Role } from "../../db/models";
import { hashPassword } from "../../lib/password";
import { resetDb, grantActions } from "../../../test/helpers";
import { ACTIONS } from "../iam/actions.catalog";
import { AP_DEFAULT_MAP } from "./approval.service";

const app = createApp();
const authed = (t: string) => ({ Authorization: `Bearer ${t}` });
const ADMIN = [ACTIONS.APPROVAL_READ, ACTIONS.APPROVAL_MANAGE, ACTIONS.APPROVAL_APPROVE, ACTIONS.MS_READ, ACTIONS.MS_MANAGE];
const APPROVER = [ACTIONS.APPROVAL_READ, ACTIONS.APPROVAL_APPROVE];

let orgSeq = 0;
async function makeOrg(): Promise<string> {
  const code = `AO${++orgSeq}`;
  const org = await Organization.create({ name: code, code, type: "Tenant", status: "Active", parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null });
  return org.id;
}
async function makeUser(orgId: string, username: string, fullName: string, actions: string[]): Promise<{ token: string; userId: string }> {
  const user = await User.create({ orgId, tenantId: null, fullName, username, email: `${username}@x.io`, passwordHash: await hashPassword("ChangeMe123"), status: "Active", position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null });
  const role = await Role.create({ name: `R-${username}`, tierScope: "Tenant", orgId, isSuperAdmin: false, status: true });
  await (user as unknown as { setRoles: (r: Role[]) => Promise<unknown> }).setRoles([role]);
  await grantActions(role.id, actions);
  const login = await request(app).post("/v1/auth/login").send({ identifier: username, password: "ChangeMe123" });
  return { token: login.body.data.accessToken, userId: user.id };
}
async function createPolicy(token: string): Promise<string> {
  const r = await request(app).post("/v1/implementation/policies").set(authed(token)).send({ title: "Information Security Policy", status: "Draft" });
  return r.body.data.id;
}
const policyStatus = async (token: string, id: string): Promise<string> => (await request(app).get("/v1/implementation/policies").set(authed(token))).body.data.find((p: { id: string }) => p.id === id).status;

describe("approval engine", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("runs the S1 two-gate flow: submit → MS Team → Top Management → Published", async () => {
    const orgId = await makeOrg();
    const admin = await makeUser(orgId, "ap-admin", "Admin User", ADMIN);
    const mst = await makeUser(orgId, "ap-mst", "Monica Rambeau", APPROVER);
    const tm = await makeUser(orgId, "ap-tm", "Jennifer Walters", APPROVER);
    // Pools: Monica = MS Team (required), Jennifer = Top Management (final).
    await request(app).put(`/v1/approvals/pools/${mst.userId}`).set(authed(admin.token)).send({ isMST: true, mstPriority: "required" });
    await request(app).put(`/v1/approvals/pools/${tm.userId}`).set(authed(admin.token)).send({ isTM: true, tmFinal: true });

    const policyId = await createPolicy(admin.token);
    // Default scheme for policies is S1.
    expect((await request(app).get("/v1/approvals/module-map").set(authed(admin.token))).body.data.policies).toBe("S1");

    const sub = await request(app).post(`/v1/approvals/records/policies/${policyId}/submit`).set(authed(admin.token));
    expect(sub.body.data.status).toBe("Under Review");
    expect(sub.body.data.record.gates).toHaveLength(2);
    expect(sub.body.data.record.gates[0]).toMatchObject({ pool: "mst", required: ["Monica Rambeau"] });

    // Admin is not in the MST pool → cannot approve gate 1.
    expect((await request(app).post(`/v1/approvals/records/policies/${policyId}/approve`).set(authed(admin.token))).status).toBe(403);

    // Monica clears gate 1 → advances to Pending Final Approval.
    const g1 = await request(app).post(`/v1/approvals/records/policies/${policyId}/approve`).set(authed(mst.token));
    expect(g1.body.data).toMatchObject({ result: "advanced", status: "Pending Final Approval" });
    // Monica cannot sign the Top Management gate.
    expect((await request(app).post(`/v1/approvals/records/policies/${policyId}/approve`).set(authed(mst.token))).status).toBe(403);

    // Jennifer clears the final gate → Published.
    const g2 = await request(app).post(`/v1/approvals/records/policies/${policyId}/approve`).set(authed(tm.token));
    expect(g2.body.data).toMatchObject({ result: "final", status: "Published" });
    expect(await policyStatus(admin.token, policyId)).toBe("Published");
    // No further active approval.
    expect((await request(app).get(`/v1/approvals/records/policies/${policyId}`).set(authed(admin.token))).body.data.state).toBe("approved");
  });

  it("self-serve (S2) publishes directly; withdraw and request-revision reset status", async () => {
    const orgId = await makeOrg();
    const admin = await makeUser(orgId, "ap-a2", "Admin", ADMIN);
    const mst = await makeUser(orgId, "ap-m2", "Reviewer", APPROVER);
    const tm = await makeUser(orgId, "ap-t2", "Final Approver", APPROVER);
    await request(app).put(`/v1/approvals/pools/${mst.userId}`).set(authed(admin.token)).send({ isMST: true });
    await request(app).put(`/v1/approvals/pools/${tm.userId}`).set(authed(admin.token)).send({ isTM: true, tmFinal: true });

    // Self-serve: assign S2 → submit publishes immediately, no approval record.
    await request(app).put("/v1/approvals/module-map").set(authed(admin.token)).send({ moduleKey: "policies", schemeId: "S2" });
    const p1 = await createPolicy(admin.token);
    const s1 = await request(app).post(`/v1/approvals/records/policies/${p1}/submit`).set(authed(admin.token));
    expect(s1.body.data.status).toBe("Published");
    expect(s1.body.data.record).toBeNull();

    // Back to S1: submit then withdraw (no signatures) → Draft.
    await request(app).put("/v1/approvals/module-map").set(authed(admin.token)).send({ moduleKey: "policies", schemeId: "S1" });
    const p2 = await createPolicy(admin.token);
    await request(app).post(`/v1/approvals/records/policies/${p2}/submit`).set(authed(admin.token));
    const wd = await request(app).post(`/v1/approvals/records/policies/${p2}/withdraw`).set(authed(admin.token));
    expect(wd.body.data.status).toBe("Draft");

    // Submit again, MST signs, then request revision → Needs Revision; the
    // approval run is kept (state "returned") and the reviewer's comment is
    // stored on the record instead of being destroyed with the run.
    await request(app).post(`/v1/approvals/records/policies/${p2}/submit`).set(authed(admin.token));
    await request(app).post(`/v1/approvals/records/policies/${p2}/approve`).set(authed(mst.token));
    // After a signature, the author can no longer withdraw.
    expect((await request(app).post(`/v1/approvals/records/policies/${p2}/withdraw`).set(authed(admin.token))).status).toBe(409);
    const rev = await request(app).post(`/v1/approvals/records/policies/${p2}/request-revision`).set(authed(admin.token))
      .send({ comments: "Tighten section 2 before resubmitting" });
    expect(rev.body.data.status).toBe("Needs Revision");
    expect((await request(app).get(`/v1/approvals/records/policies/${p2}`).set(authed(admin.token))).body.data.state).toBe("returned");
    const p2rec = (await request(app).get("/v1/implementation/policies").set(authed(admin.token)))
      .body.data.find((p: { id: string }) => p.id === p2);
    expect(p2rec.data.reviewComments).toBe("Tighten section 2 before resubmitting");
    // A returned record can be resubmitted into a fresh run.
    const resub = await request(app).post(`/v1/approvals/records/policies/${p2}/submit`).set(authed(admin.token));
    expect(resub.body.data.record.state).toBe("active");
  });

  it("blocks self-approval when disabled, and blocks submit when the pool is empty", async () => {
    const orgId = await makeOrg();
    const admin = await makeUser(orgId, "ap-a3", "Owner", [...ADMIN]);
    // Owner is the sole MS Team member and also the submitter.
    await request(app).put(`/v1/approvals/pools/${admin.userId}`).set(authed(admin.token)).send({ isMST: true });
    await request(app).put("/v1/approvals/module-map").set(authed(admin.token)).send({ moduleKey: "policies", schemeId: "S0" }); // single MST gate

    // Disable self-approval → the author (also the sole approver) is blocked.
    await request(app).put("/v1/approvals/settings").set(authed(admin.token)).send({ selfApprovalAllowed: false });
    const p1 = await createPolicy(admin.token);
    await request(app).post(`/v1/approvals/records/policies/${p1}/submit`).set(authed(admin.token));
    expect((await request(app).post(`/v1/approvals/records/policies/${p1}/approve`).set(authed(admin.token))).status).toBe(403);

    // Re-enable → the author can self-approve the single MST gate → Published.
    await request(app).put("/v1/approvals/settings").set(authed(admin.token)).send({ selfApprovalAllowed: true });
    const g = await request(app).post(`/v1/approvals/records/policies/${p1}/approve`).set(authed(admin.token));
    expect(g.body.data).toMatchObject({ result: "final", status: "Published" });

    // Empty pool blocks submission: a fresh org with no Top-Management member cannot submit under S1.
    const org2 = await makeOrg();
    const solo = await makeUser(org2, "ap-solo", "Solo Admin", ADMIN);
    await request(app).put(`/v1/approvals/pools/${solo.userId}`).set(authed(solo.token)).send({ isMST: true }); // MST only, no TM
    const p2 = await createPolicy(solo.token); // policies default S1 needs a TM gate
    const blocked = await request(app).post(`/v1/approvals/records/policies/${p2}/submit`).set(authed(solo.token));
    expect(blocked.status).toBe(400);
  });

  it("manages custom schemes, module map and pools; enforces grants", async () => {
    const orgId = await makeOrg();
    const admin = await makeUser(orgId, "ap-a5", "Admin", ADMIN);
    // Built-ins always present.
    const schemes = (await request(app).get("/v1/approvals/schemes").set(authed(admin.token))).body.data;
    expect(schemes.map((s: { id: string }) => s.id)).toEqual(expect.arrayContaining(["S0", "S1", "S2"]));

    // Create a custom scheme → C1, final gate flagged.
    const c = await request(app).post("/v1/approvals/schemes").set(authed(admin.token)).send({ name: "Three-Gate", gates: [{ label: "Team", pool: "mst" }, { label: "Review", pool: "mst" }, { label: "Board", pool: "top" }] });
    expect(c.body.data).toMatchObject({ id: "C1", kind: "custom" });
    expect(c.body.data.gates[2].isFinalGate).toBe(true);
    // Empty-gates rejected.
    expect((await request(app).post("/v1/approvals/schemes").set(authed(admin.token)).send({ name: "X", gates: [] })).status).toBe(400);

    // Assign it, then delete → module falls back to default.
    await request(app).put("/v1/approvals/module-map").set(authed(admin.token)).send({ moduleKey: "policies", schemeId: "C1" });
    expect((await request(app).get("/v1/approvals/module-map").set(authed(admin.token))).body.data.policies).toBe("C1");
    await request(app).delete("/v1/approvals/schemes/C1").set(authed(admin.token));
    expect((await request(app).get("/v1/approvals/module-map").set(authed(admin.token))).body.data.policies).toBe("S1");

    // Pool listing includes the org's users with default flags.
    expect((await request(app).get("/v1/approvals/pools").set(authed(admin.token))).body.data.length).toBeGreaterThanOrEqual(1);

    // Grants: an approver without MANAGE cannot edit schemes.
    const weak = await makeUser(orgId, "ap-weak", "Weak", APPROVER);
    expect((await request(app).post("/v1/approvals/schemes").set(authed(weak.token)).send({ name: "Y", gates: [{ label: "G", pool: "mst" }] })).status).toBe(403);
    expect((await request(app).get("/v1/approvals/schemes").set(authed(weak.token))).status).toBe(200);
  });

  // Wave P task P-1.5: this backend intentionally does NOT enumerate "every
  // governed module" — that set is derived entirely on the frontend from the
  // tenant nav (`AP_MODULE_GROUPS`, `lib/api/types.ts`), which this backend
  // has no equivalent of and would only be able to mirror by hand (see the
  // doc comment on `AP_DEFAULT_MAP`, approval.service.ts). The BE's only
  // governed-module data is `AP_DEFAULT_MAP` (explicit non-S0 overrides) plus
  // whatever an org has actually assigned; any other syntactically valid
  // module key is accepted on write — matching OD's own `apSetModuleScheme`,
  // which performs no key-membership check either (app.html:16231).
  it("serves the default-map overrides and accepts assignments for any module key", async () => {
    const orgId = await makeOrg();
    const admin = await makeUser(orgId, "ap-a6", "Admin", ADMIN);

    const map = (await request(app).get("/v1/approvals/module-map").set(authed(admin.token))).body.data;
    // Every explicit AP_DEFAULT_MAP override is present with its assigned value.
    for (const [key, schemeId] of Object.entries(AP_DEFAULT_MAP)) expect(map[key]).toBe(schemeId);
    // A module with no AP_DEFAULT_MAP entry and no prior assignment simply
    // isn't in the response — the frontend resolves that missing case to
    // "S0" itself (`moduleSchemeId`, `app/(app)/approvals/page.tsx`).
    expect(map.training).toBeUndefined();

    // Any module key — including one this backend has never heard of before,
    // as if the frontend nav had just grown a new module — accepts (and
    // stores) an assignment. No 400, no code change required here.
    const put = await request(app).put("/v1/approvals/module-map").set(authed(admin.token)).send({ moduleKey: "a-brand-new-nav-module", schemeId: "S1" });
    expect(put.status).toBe(200);
    expect((await request(app).get("/v1/approvals/module-map").set(authed(admin.token))).body.data["a-brand-new-nav-module"]).toBe("S1");
  });

  // OD `polPublishCore`: publishing supersedes the previously published policy
  // in the same lineage, so only one version of a policy is ever live, and
  // `nextReview` is derived from the review frequency when left blank.
  it("supersedes the prior published policy by lineage and computes nextReview", async () => {
    const orgId = await makeOrg();
    const admin = await makeUser(orgId, "pl-admin", "Admin User", ADMIN);
    const tm = await makeUser(orgId, "pl-tm", "Jennifer Walters", APPROVER);
    await request(app).put(`/v1/approvals/pools/${tm.userId}`).set(authed(admin.token)).send({ isTM: true, tmFinal: true });
    await request(app).put(`/v1/approvals/pools/${admin.userId}`).set(authed(admin.token)).send({ isMST: true, mstPriority: "required" });

    const publish = async (id: string) => {
      await request(app).post(`/v1/approvals/records/policies/${id}/submit`).set(authed(admin.token));
      await request(app).post(`/v1/approvals/records/policies/${id}/approve`).set(authed(admin.token));
      await request(app).post(`/v1/approvals/records/policies/${id}/approve`).set(authed(tm.token));
    };
    const fetch = async (id: string) =>
      (await request(app).get("/v1/implementation/policies").set(authed(admin.token))).body.data.find((p: { id: string }) => p.id === id);

    const v1 = (await request(app).post("/v1/implementation/policies").set(authed(admin.token))
      .send({ title: "Information Security Policy", status: "Draft", data: { reviewFreq: "Annually", effectiveDate: "2026-01-01" } })).body.data.id;
    await publish(v1);

    const p1 = await fetch(v1);
    expect(p1.status).toBe("Published");
    expect(p1.data.lineageId).toBe(v1);
    // Annually → effectiveDate + 12 months.
    expect(String(p1.data.nextReview).slice(0, 10)).toBe("2027-01-01");

    // A second policy in the SAME lineage supersedes the first on publish.
    const v2 = (await request(app).post("/v1/implementation/policies").set(authed(admin.token))
      .send({ title: "Information Security Policy v2", status: "Draft", data: { lineageId: v1, reviewFreq: "Annually" } })).body.data.id;
    await publish(v2);

    expect((await fetch(v1)).status).toBe("Superseded");
    expect((await fetch(v1)).data.supersededBy).toBe(v2);
    expect((await fetch(v2)).status).toBe("Published");
  });

  it("leaves an unrelated policy lineage untouched when publishing", async () => {
    const orgId = await makeOrg();
    const admin = await makeUser(orgId, "pl2-admin", "Admin User", ADMIN);
    const tm = await makeUser(orgId, "pl2-tm", "Jennifer Walters", APPROVER);
    await request(app).put(`/v1/approvals/pools/${tm.userId}`).set(authed(admin.token)).send({ isTM: true, tmFinal: true });
    await request(app).put(`/v1/approvals/pools/${admin.userId}`).set(authed(admin.token)).send({ isMST: true, mstPriority: "required" });

    const publish = async (id: string) => {
      await request(app).post(`/v1/approvals/records/policies/${id}/submit`).set(authed(admin.token));
      await request(app).post(`/v1/approvals/records/policies/${id}/approve`).set(authed(admin.token));
      await request(app).post(`/v1/approvals/records/policies/${id}/approve`).set(authed(tm.token));
    };
    const fetch = async (id: string) =>
      (await request(app).get("/v1/implementation/policies").set(authed(admin.token))).body.data.find((p: { id: string }) => p.id === id);

    const quality = (await request(app).post("/v1/implementation/policies").set(authed(admin.token)).send({ title: "Quality Policy", status: "Draft" })).body.data.id;
    await publish(quality);
    const security = (await request(app).post("/v1/implementation/policies").set(authed(admin.token)).send({ title: "Security Policy", status: "Draft" })).body.data.id;
    await publish(security);

    // Different lineages — both stay Published.
    expect((await fetch(quality)).status).toBe("Published");
    expect((await fetch(security)).status).toBe("Published");
  });
});

// OD's Internal Documents flow is bespoke (cdSubmit → cdReview → cdPublish),
// not the multi-gate engine: submit needs an approver, a single reviewer
// decides Approve / Request Revision / Reject, and publishing is a separate
// explicit step gated on Approved.
describe("controlled documents workflow", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  const createDoc = async (token: string, extra: Record<string, unknown> = {}) => {
    const r = await request(app).post("/v1/implementation/documents").set(authed(token)).send({
      title: "Access Control Procedure", status: "Draft", owner: "IT Lead",
      data: { type: "Procedure", category: "Information Security", approver: "Jennifer Walters", changeSummary: "Initial issue", reviewFreq: "Annually", content: "v1", ...extra },
    });
    return r.body.data;
  };
  const fetchDoc = async (token: string, id: string) =>
    (await request(app).get("/v1/implementation/documents").set(authed(token))).body.data.find((d: { id: string }) => d.id === id);

  it("runs submit → approve (with effective date) → explicit publish, deriving next review", async () => {
    const orgId = await makeOrg();
    const admin = await makeUser(orgId, "cd-a1", "Admin", ADMIN);
    const doc = await createDoc(admin.token);
    // TYPECODE-NNNN id scheme (no framework → no FW segment).
    expect(doc.code).toBe("PROC-0001");
    expect(doc.data.version).toBe("0.1");

    // Publish is gated on Approved — straight from Draft it must refuse.
    expect((await request(app).post(`/v1/approvals/records/documents/${doc.id}/publish`).set(authed(admin.token))).status).toBe(409);

    const sub = await request(app).post(`/v1/approvals/records/documents/${doc.id}/submit`).set(authed(admin.token));
    expect(sub.body.data.status).toBe("Under Review");
    expect((await fetchDoc(admin.token, doc.id)).data.submittedBy).toBeTruthy();

    // Approve is not Publish — the record parks at Approved.
    const rev = await request(app).post(`/v1/approvals/records/documents/${doc.id}/review`).set(authed(admin.token))
      .send({ decision: "Approve", effectiveDate: "2026-09-01", comments: "Looks complete" });
    expect(rev.body.data.status).toBe("Approved");
    const approved = await fetchDoc(admin.token, doc.id);
    expect(approved.data.reviewDecision).toBe("Approve");
    expect(approved.data.reviewComments).toBe("Looks complete");
    expect(approved.data.effectiveDate).toBe(new Date("2026-09-01").toISOString());

    const pub = await request(app).post(`/v1/approvals/records/documents/${doc.id}/publish`).set(authed(admin.token));
    expect(pub.body.data.status).toBe("Published");
    const published = await fetchDoc(admin.token, doc.id);
    expect(published.data.publishedBy).toBeTruthy();
    // Annually from the approved effective date.
    expect(published.data.nextReview).toBe(new Date("2027-09-01").toISOString());
  });

  it("supports Request Revision (stores the comment) and Reject", async () => {
    const orgId = await makeOrg();
    const admin = await makeUser(orgId, "cd-a2", "Admin", ADMIN);
    const doc = await createDoc(admin.token);
    await request(app).post(`/v1/approvals/records/documents/${doc.id}/submit`).set(authed(admin.token));
    const rr = await request(app).post(`/v1/approvals/records/documents/${doc.id}/review`).set(authed(admin.token))
      .send({ decision: "Request Revision", comments: "Add the revocation steps" });
    expect(rr.body.data.status).toBe("Revision Requested");
    const returned = await fetchDoc(admin.token, doc.id);
    expect(returned.data.reviewComments).toBe("Add the revocation steps");

    // Revision Requested can be resubmitted, then rejected.
    await request(app).post(`/v1/approvals/records/documents/${doc.id}/submit`).set(authed(admin.token));
    const rj = await request(app).post(`/v1/approvals/records/documents/${doc.id}/review`).set(authed(admin.token))
      .send({ decision: "Reject", comments: "Out of scope" });
    expect(rj.body.data.status).toBe("Rejected");
    // A rejected document cannot be reviewed again.
    expect((await request(app).post(`/v1/approvals/records/documents/${doc.id}/review`).set(authed(admin.token))
      .send({ decision: "Approve" })).status).toBe(409);
  });

  it("gates submit on the requireApprover setting", async () => {
    const orgId = await makeOrg();
    const admin = await makeUser(orgId, "cd-a3", "Admin", ADMIN);
    // Relax the save gates so a doc without an approver can exist…
    await request(app).put("/v1/implementation/documents/settings").set(authed(admin.token))
      .send({ requireApprover: false, requireChange: false, requireOwner: false });
    const doc = await createDoc(admin.token, { approver: "" });
    // …then turn the submit gate back on.
    await request(app).put("/v1/implementation/documents/settings").set(authed(admin.token)).send({ requireApprover: true });
    const sub = await request(app).post(`/v1/approvals/records/documents/${doc.id}/submit`).set(authed(admin.token));
    expect(sub.status).toBe(400);
    expect(sub.body.error.code).toBe("DOC_APPROVER_REQUIRED");

    // Turning the gate off lets it through.
    await request(app).put("/v1/implementation/documents/settings").set(authed(admin.token)).send({ requireApprover: false });
    expect((await request(app).post(`/v1/approvals/records/documents/${doc.id}/submit`).set(authed(admin.token))).status).toBe(200);
  });

  it("publishing a revision supersedes the prior published version in the lineage", async () => {
    const orgId = await makeOrg();
    const admin = await makeUser(orgId, "cd-a4", "Admin", ADMIN);
    const v1 = await createDoc(admin.token);
    await request(app).post(`/v1/approvals/records/documents/${v1.id}/submit`).set(authed(admin.token));
    await request(app).post(`/v1/approvals/records/documents/${v1.id}/review`).set(authed(admin.token)).send({ decision: "Approve" });
    await request(app).post(`/v1/approvals/records/documents/${v1.id}/publish`).set(authed(admin.token));

    // Editing the published doc forks a draft; the original STAYS Published.
    const fork = await request(app).put(`/v1/implementation/documents/${v1.id}`).set(authed(admin.token))
      .send({ data: { type: "Procedure", approver: "Jennifer Walters", changeSummary: "Clarify revocation", content: "v2" } });
    const v2 = fork.body.data;
    expect(v2.id).not.toBe(v1.id);
    expect(v2.status).toBe("Draft");
    expect(v2.data.lineageId).toBe(v1.id);
    expect(v2.data.prevVersionId).toBe(v1.id);
    expect((await fetchDoc(admin.token, v1.id)).status).toBe("Published"); // live during the revision cycle

    // Publishing the revision is what supersedes v1.
    await request(app).post(`/v1/approvals/records/documents/${v2.id}/submit`).set(authed(admin.token));
    await request(app).post(`/v1/approvals/records/documents/${v2.id}/review`).set(authed(admin.token)).send({ decision: "Approve" });
    await request(app).post(`/v1/approvals/records/documents/${v2.id}/publish`).set(authed(admin.token));
    const oldV1 = await fetchDoc(admin.token, v1.id);
    expect(oldV1.status).toBe("Superseded");
    expect(oldV1.data.supersededBy).toBe(v2.id);
    expect((await fetchDoc(admin.token, v2.id)).status).toBe("Published");
  });
});
