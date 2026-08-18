import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import { initModels, Organization, User, Role } from "../../db/models";
import { hashPassword } from "../../lib/password";
import { resetDb, grantActions } from "../../../test/helpers";
import { ACTIONS } from "../iam/actions.catalog";

const app = createApp();
const authed = (t: string) => ({ Authorization: `Bearer ${t}` });
const ADMIN = [ACTIONS.MS_READ, ACTIONS.MS_MANAGE, ACTIONS.APPROVAL_READ, ACTIONS.APPROVAL_MANAGE, ACTIONS.APPROVAL_APPROVE];

let orgSeq = 0;
async function makeOrg(): Promise<string> {
  const code = `PO${++orgSeq}`;
  const org = await Organization.create({ name: code, code, type: "Tenant", status: "Active", parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null });
  return org.id;
}
async function makeUser(orgId: string, username: string, fullName: string, actions = ADMIN): Promise<{ token: string; userId: string }> {
  const user = await User.create({ orgId, tenantId: null, fullName, username, email: `${username}@x.io`, passwordHash: await hashPassword("ChangeMe123"), status: "Active", position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null });
  const role = await Role.create({ name: `R-${username}`, tierScope: "Tenant", orgId, isSuperAdmin: false, status: true });
  await (user as unknown as { setRoles: (r: Role[]) => Promise<unknown> }).setRoles([role]);
  await grantActions(role.id, actions);
  const login = await request(app).post("/v1/auth/login").send({ identifier: username, password: "ChangeMe123" });
  return { token: login.body.data.accessToken, userId: user.id };
}

describe("policies module (PL1/PL2 — framework-coded IDs + versioning-on-edit)", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("PL2: High-Level policies get POL-<FWCODE>-NNNN ids; Specific get POL-NNNN; one shared sequence", async () => {
    const orgId = await makeOrg();
    const { token } = await makeUser(orgId, "pol-t1", "Jennifer Walters");
    const hi = await request(app).post("/v1/implementation/policies").set(authed(token))
      .send({ title: "Quality Policy", frameworks: ["ISO 9001:2015"], data: { category: "High-Level Policy" } });
    expect(hi.status).toBe(201);
    expect(hi.body.data.code).toBe("POL-QMS-0001");
    expect(hi.body.data.data.version).toBe("1");

    const sp = await request(app).post("/v1/implementation/policies").set(authed(token))
      .send({ title: "Access Control Policy", frameworks: ["ISO/IEC 27001:2022"], data: { category: "Specific Policy" } });
    // The sequence is shared across framework codes (OD polNum strips the FWCODE).
    expect(sp.body.data.code).toBe("POL-0002");

    const isms = await request(app).post("/v1/implementation/policies").set(authed(token))
      .send({ title: "Information Security Policy", frameworks: ["ISO/IEC 27001:2022"], data: { category: "High-Level Policy" } });
    expect(isms.body.data.code).toBe("POL-ISMS-0003");
  });

  it("PL2: nextReview is derived from effective date + review frequency on save", async () => {
    const orgId = await makeOrg();
    const { token } = await makeUser(orgId, "pol-t2", "Jennifer Walters");
    const r = await request(app).post("/v1/implementation/policies").set(authed(token))
      .send({ title: "P", data: { category: "Specific Policy", effectiveDate: "2026-01-15T00:00:00.000Z", reviewFreq: "Quarterly", nextReview: "hand-set" } });
    expect(String(r.body.data.data.nextReview).slice(0, 10)).toBe("2026-04-15");
  });

  it("PL1: editing a Published policy forks a new Draft (v+1, lineage, cleared stamps); original stays Published", async () => {
    const orgId = await makeOrg();
    const { token } = await makeUser(orgId, "pol-t3", "Jennifer Walters");
    const created = await request(app).post("/v1/implementation/policies").set(authed(token))
      .send({ title: "Quality Policy", frameworks: ["ISO 9001:2015"], data: { category: "High-Level Policy", statement: "v1 statement", reviewFreq: "Annually" } });
    const id = created.body.data.id as string;
    // Simulate a legacy published policy via a pure status transition (no data → no fork).
    const pub = await request(app).put(`/v1/implementation/policies/${id}`).set(authed(token))
      .send({ status: "Published" });
    expect(pub.body.data.status).toBe("Published");

    // A content edit while Published must fork, not mutate.
    const fork = await request(app).put(`/v1/implementation/policies/${id}`).set(authed(token))
      .send({ data: { category: "High-Level Policy", statement: "v2 statement", reviewFreq: "Annually", approvedBy: "X", publishedBy: "X" } });
    expect(fork.status).toBe(200);
    const draft = fork.body.data;
    expect(draft.id).not.toBe(id);
    expect(draft.status).toBe("Draft");
    expect(draft.code).toBe("POL-QMS-0002");
    expect(draft.data).toMatchObject({ version: "2", lineageId: id, prevVersionId: id, statement: "v2 statement" });
    // Approval/publish stamps are cleared on the fork.
    expect(draft.data.approvedBy).toBe("");
    expect(draft.data.publishedBy).toBe("");

    // The original is untouched and still Published.
    const list = await request(app).get("/v1/implementation/policies").set(authed(token));
    const orig = list.body.data.find((p: { id: string }) => p.id === id);
    expect(orig.status).toBe("Published");
    expect(orig.data.statement).toBe("v1 statement");
    expect(list.body.data).toHaveLength(2);
  });

  it("PL1: publishing the forked draft supersedes the original in the same lineage (publishWithLineage)", async () => {
    const orgId = await makeOrg();
    const admin = await makeUser(orgId, "pol-t4", "Admin User");
    const tm = await makeUser(orgId, "pol-t4tm", "Jennifer Walters");
    await request(app).put(`/v1/approvals/pools/${tm.userId}`).set(authed(admin.token)).send({ isTM: true, tmFinal: true });
    // Single final gate so one sign-off publishes.
    await request(app).put("/v1/approvals/module-map").set(authed(admin.token)).send({ moduleKey: "policies", schemeId: "S1" });
    const mst = await makeUser(orgId, "pol-t4m", "Monica Rambeau");
    await request(app).put(`/v1/approvals/pools/${mst.userId}`).set(authed(admin.token)).send({ isMST: true, mstPriority: "required" });

    const created = await request(app).post("/v1/implementation/policies").set(authed(admin.token))
      .send({ title: "Quality Policy", frameworks: ["ISO 9001:2015"], data: { category: "High-Level Policy", statement: "v1", reviewFreq: "Annually" } });
    const v1 = created.body.data.id as string;
    await request(app).put(`/v1/implementation/policies/${v1}`).set(authed(admin.token)).send({ status: "Published" });

    // Fork v2, then run it through the two-gate engine to publish.
    const fork = await request(app).put(`/v1/implementation/policies/${v1}`).set(authed(admin.token))
      .send({ data: { category: "High-Level Policy", statement: "v2", reviewFreq: "Annually" } });
    const v2 = fork.body.data.id as string;
    await request(app).post(`/v1/approvals/records/policies/${v2}/submit`).set(authed(admin.token));
    await request(app).post(`/v1/approvals/records/policies/${v2}/approve`).set(authed(mst.token));
    const final = await request(app).post(`/v1/approvals/records/policies/${v2}/approve`).set(authed(tm.token));
    expect(final.body.data).toMatchObject({ result: "final", status: "Published" });

    const list = await request(app).get("/v1/implementation/policies").set(authed(admin.token));
    const rows = list.body.data as { id: string; status: string; data: Record<string, unknown> }[];
    const orig = rows.find((p) => p.id === v1)!;
    const next = rows.find((p) => p.id === v2)!;
    expect(orig.status).toBe("Superseded");
    expect(orig.data.supersededBy).toBe(v2);
    expect(next.status).toBe("Published");
    expect(next.data.supersedes).toBe(v1);
    expect(next.data.publishedBy).toBe("Jennifer Walters");
  });
});
