import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import { initModels, Organization, User, Role } from "../../db/models";
import { hashPassword } from "../../lib/password";
import { resetDb, grantActions } from "../../../test/helpers";
import { ACTIONS } from "../iam/actions.catalog";

const app = createApp();
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

async function soLogin(): Promise<string> {
  const so = await Organization.create({
    name: "AXIA", code: "AXIA", type: "ServiceOwner", status: "Active",
    parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null,
  });
  const admin = await User.create({
    orgId: so.id, tenantId: null, fullName: "Admin", username: "soadmin", email: "soadmin@axia.io",
    passwordHash: await hashPassword("ChangeMe123"), status: "Active",
    position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null,
  });
  const role = await Role.create({ name: "SO Administrator", tierScope: "ServiceOwner", orgId: so.id, isSuperAdmin: true, status: true });
  await (admin as unknown as { setRoles: (roles: Role[]) => Promise<unknown> }).setRoles([role]);
  const login = await request(app).post("/v1/auth/login").send({ identifier: "soadmin", password: "ChangeMe123" });
  return login.body.data.accessToken;
}

async function tenantWithGrants(): Promise<string> {
  const tenant = await Organization.create({
    name: "Acme", code: "ACME", type: "Tenant", status: "Active",
    parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null,
  });
  const user = await User.create({
    orgId: tenant.id, tenantId: tenant.id, fullName: "T", username: "tuser", email: "t@acme.io",
    passwordHash: await hashPassword("ChangeMe123"), status: "Active",
    position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null,
  });
  const role = await Role.create({ name: "Tenant Admin", tierScope: "Tenant", orgId: tenant.id, isSuperAdmin: false, status: true });
  await (user as unknown as { setRoles: (roles: Role[]) => Promise<unknown> }).setRoles([role]);
  await grantActions(role.id, [ACTIONS.REQUIREMENT_READ, ACTIONS.REQUIREMENT_CREATE, ACTIONS.ELEMENT_READ, ACTIONS.ELEMENT_CREATE]);
  const login = await request(app).post("/v1/auth/login").send({ identifier: "tuser", password: "ChangeMe123" });
  return login.body.data.accessToken;
}

async function makeFramework(token: string, name = "ISO 9001:2015"): Promise<string> {
  const groups = await request(app).get("/v1/framework-groups").set(bearer(token));
  const standards = (groups.body.data as { id: string; name: string }[]).find((g) => g.name === "Standards");
  const fw = await request(app).post("/v1/frameworks").set(bearer(token)).send({ groupId: standards?.id, name });
  return fw.body.data.id as string;
}

describe("requirements + elements + criteria + xref", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("requires authentication", async () => {
    expect((await request(app).get("/v1/requirements")).status).toBe(401);
    expect((await request(app).get("/v1/elements")).status).toBe(401);
  });

  it("forbids a non-Service-Owner even with grants", async () => {
    const token = await tenantWithGrants();
    expect((await request(app).post("/v1/elements").set(bearer(token)).send({ name: "X" })).status).toBe(403);
  });

  it("creates a requirement with subject + criteria count and lists it", async () => {
    const token = await soLogin();
    const frameworkId = await makeFramework(token);
    const res = await request(app).post("/v1/requirements").set(bearer(token))
      .send({ frameworkId, code: "Clause 9.2.1", subject: "Internal Audit", description: "Conduct internal audits." });
    expect(res.status).toBe(201);
    expect(res.body.data.subject).toBe("Internal Audit");
    expect(res.body.data.frameworkName).toBe("ISO 9001:2015");
    expect(res.body.data.criteriaCount).toBe(0);
    expect(res.body.data.mappedElements).toEqual([]);

    const list = await request(app).get(`/v1/requirements?frameworkId=${frameworkId}`).set(bearer(token));
    expect(list.body.data).toHaveLength(1);
  });

  it("rejects a duplicate requirement code within a framework", async () => {
    const token = await soLogin();
    const frameworkId = await makeFramework(token);
    await request(app).post("/v1/requirements").set(bearer(token)).send({ frameworkId, code: "DUP", subject: "a", description: "a" });
    const res = await request(app).post("/v1/requirements").set(bearer(token)).send({ frameworkId, code: "DUP", subject: "b", description: "b" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("DUPLICATE_CODE");
  });

  it("manages element ↔ requirement mappings and reflects them both ways", async () => {
    const token = await soLogin();
    const frameworkId = await makeFramework(token);
    const req = await request(app).post("/v1/requirements").set(bearer(token)).send({ frameworkId, code: "Clause 9.2.1", subject: "Internal Audit", description: "x" });
    const el = await request(app).post("/v1/elements").set(bearer(token)).send({ name: "Internal Audit" });

    const set = await request(app).put(`/v1/elements/${el.body.data.id}/mappings`).set(bearer(token)).send({ requirementIds: [req.body.data.id] });
    expect(set.status).toBe(200);
    expect(set.body.data.mappedRequirementCount).toBe(1);
    expect(set.body.data.mappedRequirements[0].code).toBe("Clause 9.2.1");

    const reqList = await request(app).get(`/v1/requirements?frameworkId=${frameworkId}`).set(bearer(token));
    expect(reqList.body.data[0].mappedElements[0].name).toBe("Internal Audit");

    const xref = await request(app).get("/v1/framework-xref").set(bearer(token));
    expect(xref.status).toBe(200);
    expect(xref.body.data.byElement[0].requirements[0].code).toBe("Clause 9.2.1");
    expect(xref.body.data.byRequirement[0].elements[0].name).toBe("Internal Audit");
  });

  it("rejects a duplicate element name", async () => {
    const token = await soLogin();
    await request(app).post("/v1/elements").set(bearer(token)).send({ name: "Risk Assessment" });
    const res = await request(app).post("/v1/elements").set(bearer(token)).send({ name: "Risk Assessment" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("DUPLICATE_NAME");
  });

  it("manages criteria (0–9) for a requirement", async () => {
    const token = await soLogin();
    const frameworkId = await makeFramework(token);
    const req = await request(app).post("/v1/requirements").set(bearer(token)).send({ frameworkId, code: "C1", subject: "s", description: "d" });
    const reqId = req.body.data.id;
    const c0 = await request(app).post("/v1/criteria").set(bearer(token)).send({ requirementId: reqId, score: 0, description: "No process." });
    expect(c0.status).toBe(201);
    await request(app).post("/v1/criteria").set(bearer(token)).send({ requirementId: reqId, score: 2, description: "Planned." });

    const dup = await request(app).post("/v1/criteria").set(bearer(token)).send({ requirementId: reqId, score: 0, description: "again" });
    expect(dup.status).toBe(409);
    const bad = await request(app).post("/v1/criteria").set(bearer(token)).send({ requirementId: reqId, score: 12, description: "too high" });
    expect(bad.status).toBe(400);

    const list = await request(app).get(`/v1/criteria?requirementId=${reqId}`).set(bearer(token));
    expect(list.body.data.map((c: { score: number }) => c.score)).toEqual([0, 2]);

    const reqWithCrit = await request(app).get(`/v1/requirements?frameworkId=${frameworkId}`).set(bearer(token));
    expect(reqWithCrit.body.data[0].criteriaCount).toBe(2);
  });
});
