import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import { initModels, Organization, User, Role, FrameworkGroup } from "../../db/models";
import { hashPassword } from "../../lib/password";
import { resetDb, grantActions } from "../../../test/helpers";
import { ACTIONS } from "../iam/actions.catalog";

const app = createApp();
const authed = (t: string) => ({ Authorization: `Bearer ${t}` });
const ACT = [
  ACTIONS.FRAMEWORK_READ, ACTIONS.FRAMEWORK_CREATE, ACTIONS.ELEMENT_READ, ACTIONS.ELEMENT_MANAGE,
  ACTIONS.REQUIREMENT_READ, ACTIONS.REQUIREMENT_MANAGE, ACTIONS.ASSESSMENT_READ, ACTIONS.ASSESSMENT_MANAGE,
];

let soSeq = 0;
async function makeSo(orgType: "ServiceOwner" | "Tenant" = "ServiceOwner", actions = ACT): Promise<{ token: string; groupId: string }> {
  const tag = `so${++soSeq}`;
  const org = await Organization.create({ name: tag, code: `${orgType === "ServiceOwner" ? "AXIA" : "TEN"}-${tag}`, type: orgType, status: "Active", parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null });
  const user = await User.create({ orgId: org.id, tenantId: null, fullName: "U", username: tag, email: `${tag}@x.io`, passwordHash: await hashPassword("ChangeMe123"), status: "Active", position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null });
  const role = await Role.create({ name: `R-${tag}`, tierScope: orgType, orgId: org.id, isSuperAdmin: false, status: true });
  await (user as unknown as { setRoles: (r: Role[]) => Promise<unknown> }).setRoles([role]);
  await grantActions(role.id, actions);
  const [group] = await FrameworkGroup.findOrCreate({ where: { name: "Standards" }, defaults: { name: "Standards", sortOrder: 1 } });
  const login = await request(app).post("/v1/auth/login").send({ identifier: tag, password: "ChangeMe123" });
  return { token: login.body.data.accessToken, groupId: group.id };
}

// Build framework → requirement → element → question → response, return the ids.
async function buildChain(token: string, groupId: string) {
  const fw = await request(app).post("/v1/frameworks").set(authed(token)).send({ groupId, name: "ISO 9001:2015" });
  const el = await request(app).post("/v1/elements").set(authed(token)).send({ name: "Internal Audit" });
  const req = await request(app).post("/v1/requirements").set(authed(token)).send({ frameworkId: fw.body.data.id, code: "9.2", subject: "Internal audit", description: "d" });
  await request(app).put(`/v1/elements/${el.body.data.id}/mappings`).set(authed(token)).send({ requirementIds: [req.body.data.id] });
  const q = await request(app).post("/v1/assessment/questions").set(authed(token)).send({ elementId: el.body.data.id, text: "How is audit defined?", status: "Active" });
  const r = await request(app).post("/v1/assessment/responses").set(authed(token)).send({ questionId: q.body.data.id, text: "A formal audit programme exists.", status: "Active" });
  return { frameworkId: fw.body.data.id, elementId: el.body.data.id, requirementId: req.body.data.id, responseId: r.body.data.id };
}

describe("FWRC (framework requirement criteria join)", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("links a response to a requirement, derives the join fields, lists, updates and deletes", async () => {
    const { token, groupId } = await makeSo();
    const ids = await buildChain(token, groupId);

    const created = await request(app).post("/v1/fwrc").set(authed(token)).send({ requirementId: ids.requirementId, responseId: ids.responseId, statement: "Level 3 — a documented, monitored audit programme." });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      code: "FWRC-0001", frameworkName: "ISO 9001:2015", requirementCode: "9.2",
      elementId: ids.elementId, elementName: "Internal Audit", responseText: "A formal audit programme exists.",
      statement: "Level 3 — a documented, monitored audit programme.",
    });
    const id = created.body.data.id;

    // Query by requirement and by element (OD fwrcForReq / fwrcForEl).
    expect((await request(app).get(`/v1/fwrc?requirementId=${ids.requirementId}`).set(authed(token))).body.data).toHaveLength(1);
    expect((await request(app).get(`/v1/fwrc?elementId=${ids.elementId}`).set(authed(token))).body.data).toHaveLength(1);

    const updated = await request(app).put(`/v1/fwrc/${id}`).set(authed(token)).send({ statement: "Level 4 — optimized." });
    expect(updated.body.data.statement).toBe("Level 4 — optimized.");

    expect((await request(app).delete(`/v1/fwrc/${id}`).set(authed(token))).status).toBe(200);
    expect((await request(app).get(`/v1/fwrc?requirementId=${ids.requirementId}`).set(authed(token))).body.data).toHaveLength(0);
  });

  it("forbids non-Service-Owners and enforces action grants", async () => {
    const tenant = await makeSo("Tenant");
    expect((await request(app).get("/v1/fwrc").set(authed(tenant.token))).status).toBe(403);
    const noGrant = await makeSo("ServiceOwner", []);
    expect((await request(app).get("/v1/fwrc").set(authed(noGrant.token))).status).toBe(403);
  });
});
