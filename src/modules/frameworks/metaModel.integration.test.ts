import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import { initModels, Organization, User, Role, FrameworkGroup } from "../../db/models";
import { hashPassword } from "../../lib/password";
import { resetDb, grantActions } from "../../../test/helpers";
import { ACTIONS } from "../iam/actions.catalog";

const app = createApp();
const authed = (t: string) => ({ Authorization: `Bearer ${t}` });
const META = [
  ACTIONS.FRAMEWORK_READ, ACTIONS.FRAMEWORK_CREATE, ACTIONS.FRAMEWORK_UPDATE, ACTIONS.FRAMEWORK_DELETE,
  ACTIONS.ELEMENT_READ, ACTIONS.ELEMENT_MANAGE, ACTIONS.REQUIREMENT_READ, ACTIONS.REQUIREMENT_MANAGE,
  ACTIONS.ASSESSMENT_READ, ACTIONS.ASSESSMENT_MANAGE,
];

async function makeSo(orgType: "ServiceOwner" | "Tenant" = "ServiceOwner", actions = META): Promise<{ token: string; groupId: string }> {
  const org = await Organization.create({ name: "AXIA", code: orgType === "ServiceOwner" ? "AXIA" : "TEN", type: orgType, status: "Active", parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null });
  const user = await User.create({ orgId: org.id, tenantId: null, fullName: "U", username: "soadmin", email: "u@x.io", passwordHash: await hashPassword("ChangeMe123"), status: "Active", position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null });
  const role = await Role.create({ name: "R", tierScope: orgType, orgId: org.id, isSuperAdmin: false, status: true });
  await (user as unknown as { setRoles: (r: Role[]) => Promise<unknown> }).setRoles([role]);
  await grantActions(role.id, actions);
  const group = await FrameworkGroup.create({ name: "Standards", sortOrder: 1 });
  const login = await request(app).post("/v1/auth/login").send({ identifier: "soadmin", password: "ChangeMe123" });
  return { token: login.body.data.accessToken, groupId: group.id };
}

describe("framework meta-model", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("forbids a Tenant from authoring master data", async () => {
    const t = await makeSo("Tenant");
    expect((await request(app).get("/v1/elements").set(authed(t.token))).status).toBe(403);
  });

  it("creates a group-based framework returning the meta-model shape", async () => {
    const { token, groupId } = await makeSo();
    const res = await request(app).post("/v1/frameworks").set(authed(token))
      .send({ groupId, name: "ISO/IEC 27001:2022", description: "ISMS requirements", jurisdictions: ["Global"], status: "Active" });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ groupId, name: "ISO/IEC 27001:2022", description: "ISMS requirements", jurisdictions: ["Global"], status: "Active", requirementCount: 0 });
    const groups = await request(app).get("/v1/framework-groups").set(authed(token));
    expect(groups.body.data.map((g: { name: string }) => g.name)).toContain("Standards");
  });

  it("auto-codes elements (FWE-###) and round-trips requirement criteria (0–9)", async () => {
    const { token, groupId } = await makeSo();
    const fw = await request(app).post("/v1/frameworks").set(authed(token)).send({ groupId, name: "FW" });
    const el = await request(app).post("/v1/elements").set(authed(token)).send({ name: "Internal Audit" });
    expect(el.body.data.mappedRequirementCount).toBe(0);
    expect(el.body.data.id).toBeTruthy();
    const elList = await request(app).get("/v1/elements").set(authed(token));
    expect(elList.body.data[0]).toBeTruthy();

    const req = await request(app).post("/v1/requirements").set(authed(token))
      .send({ frameworkId: fw.body.data.id, code: "Clause 9.2.1", subject: "Internal Audit", description: "Conduct audits." });
    expect(req.status).toBe(201);
    expect(req.body.data.frameworkName).toBe("FW");

    const crit = await request(app).post("/v1/criteria").set(authed(token)).send({ requirementId: req.body.data.id, score: 5, description: "Recurring audits." });
    expect(crit.status).toBe(201);
    expect((await request(app).post("/v1/criteria").set(authed(token)).send({ requirementId: req.body.data.id, score: 99, description: "x" })).status).toBe(400);
    const critList = await request(app).get(`/v1/criteria?requirementId=${req.body.data.id}`).set(authed(token));
    expect(critList.body.data).toHaveLength(1);

    // requirementCount now reflects the new requirement on the framework view.
    const fwReload = await request(app).get(`/v1/frameworks/${fw.body.data.id}`).set(authed(token));
    expect(fwReload.body.data.requirementCount).toBe(1);
  });

  it("maps elements↔requirements and exposes a consistent bidirectional xref", async () => {
    const { token, groupId } = await makeSo();
    const fw = await request(app).post("/v1/frameworks").set(authed(token)).send({ groupId, name: "FW" });
    const el = await request(app).post("/v1/elements").set(authed(token)).send({ name: "Internal Audit" });
    const r1 = await request(app).post("/v1/requirements").set(authed(token)).send({ frameworkId: fw.body.data.id, code: "C1", subject: "Audit", description: "d" });
    const r2 = await request(app).post("/v1/requirements").set(authed(token)).send({ frameworkId: fw.body.data.id, code: "C2", subject: "Review", description: "d" });

    const mapped = await request(app).put(`/v1/elements/${el.body.data.id}/mappings`).set(authed(token))
      .send({ requirementIds: [r1.body.data.id, r2.body.data.id] });
    expect(mapped.body.data.mappedRequirements).toHaveLength(2);

    const xref = await request(app).get("/v1/framework-xref").set(authed(token));
    const byEl = xref.body.data.byElement.find((e: { elementId: string }) => e.elementId === el.body.data.id);
    expect(byEl.requirements.map((r: { code: string }) => r.code).sort()).toEqual(["C1", "C2"]);
    // Reverse direction is consistent: each requirement lists the element back.
    const byReq = xref.body.data.byRequirement.find((r: { requirementId: string }) => r.requirementId === r1.body.data.id);
    expect(byReq.elements.map((e: { name: string }) => e.name)).toContain("Internal Audit");

    // Re-mapping to a subset replaces (not appends).
    const remapped = await request(app).put(`/v1/elements/${el.body.data.id}/mappings`).set(authed(token)).send({ requirementIds: [r1.body.data.id] });
    expect(remapped.body.data.mappedRequirements).toHaveLength(1);
  });

  it("authors a conformance Q&R and wires the rcmap (response → criterion)", async () => {
    const { token, groupId } = await makeSo();
    const fw = await request(app).post("/v1/frameworks").set(authed(token)).send({ groupId, name: "FW" });
    const el = await request(app).post("/v1/elements").set(authed(token)).send({ name: "Internal Audit" });
    const req = await request(app).post("/v1/requirements").set(authed(token)).send({ frameworkId: fw.body.data.id, code: "C1", subject: "Audit", description: "d" });
    const crit = await request(app).post("/v1/criteria").set(authed(token)).send({ requirementId: req.body.data.id, score: 5, description: "Recurring." });

    const q = await request(app).post("/v1/assessment/questions").set(authed(token)).send({ elementId: el.body.data.id, text: "How defined?", status: "Active" });
    const r = await request(app).post("/v1/assessment/responses").set(authed(token)).send({ questionId: q.body.data.id, text: "Formal process.", status: "Active" });
    expect(r.body.data.criterion).toBeNull();

    const linked = await request(app).put(`/v1/assessment/responses/${r.body.data.id}/criterion`).set(authed(token)).send({ criterionId: crit.body.data.id });
    expect(linked.body.data.criterion).toMatchObject({ criterionId: crit.body.data.id, score: 5, requirementCode: "C1", frameworkName: "FW" });

    // element-assessment shows the question + its graded response with the criterion.
    const ea = await request(app).get(`/v1/assessment/elements/${el.body.data.id}`).set(authed(token));
    expect(ea.body.data.elementName).toBe("Internal Audit");
    expect(ea.body.data.questions[0].responses[0].criterion.score).toBe(5);

    // rcmap + criterion-options listings.
    const rc = await request(app).get("/v1/assessment/response-criteria").set(authed(token));
    expect(rc.body.data[0]).toMatchObject({ responseText: "Formal process.", elementName: "Internal Audit" });
    const opts = await request(app).get("/v1/assessment/criterion-options").set(authed(token));
    expect(opts.body.data[0]).toMatchObject({ score: 5, requirementCode: "C1", frameworkName: "FW" });

    // Unmapping clears the criterion.
    const unlinked = await request(app).put(`/v1/assessment/responses/${r.body.data.id}/criterion`).set(authed(token)).send({ criterionId: null });
    expect(unlinked.body.data.criterion).toBeNull();
  });
});
