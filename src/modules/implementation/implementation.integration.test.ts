import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import { initModels, Organization, User, Role } from "../../db/models";
import { hashPassword } from "../../lib/password";
import { resetDb, grantActions } from "../../../test/helpers";
import { ACTIONS } from "../iam/actions.catalog";

const app = createApp();
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
const setRoles = (u: User, roles: Role[]) =>
  (u as unknown as { setRoles: (r: Role[]) => Promise<unknown> }).setRoles(roles);

async function soLogin(): Promise<string> {
  const so = await Organization.create({
    name: "AXIA", code: "AXIA", type: "ServiceOwner", status: "Active",
    parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null,
  });
  const admin = await User.create({
    orgId: so.id, tenantId: null, fullName: "SO", username: "soadmin", email: "soadmin@axia.io",
    passwordHash: await hashPassword("ChangeMe123"), status: "Active",
    position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null,
  });
  const role = await Role.create({ name: "SO Administrator", tierScope: "ServiceOwner", orgId: so.id, isSuperAdmin: true, status: true });
  await setRoles(admin, [role]);
  const login = await request(app).post("/v1/auth/login").send({ identifier: "soadmin", password: "ChangeMe123" });
  return login.body.data.accessToken;
}

async function tenantLogin(code: string, username: string): Promise<{ token: string; orgId: string }> {
  const t = await Organization.create({
    name: `Tenant ${code}`, code, type: "Tenant", status: "Active",
    parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: "ID", address: null,
  });
  await t.update({ tenantId: t.id });
  const u = await User.create({
    orgId: t.id, tenantId: t.id, fullName: "T", username, email: `${username}@t.io`,
    passwordHash: await hashPassword("ChangeMe123"), status: "Active",
    position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null,
  });
  const role = await Role.create({ name: "Tenant Admin", tierScope: "Tenant", orgId: t.id, isSuperAdmin: false, status: true });
  await setRoles(u, [role]);
  await grantActions(role.id, [ACTIONS.IMPLEMENTATION_READ, ACTIONS.IMPLEMENTATION_CREATE, ACTIONS.IMPLEMENTATION_UPDATE, ACTIONS.IMPLEMENTATION_DELETE]);
  const login = await request(app).post("/v1/auth/login").send({ identifier: username, password: "ChangeMe123" });
  return { token: login.body.data.accessToken, orgId: t.id };
}

describe("implementation registers", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("requires authentication", async () => {
    const res = await request(app).get("/v1/implementation/risks");
    expect(res.status).toBe(401);
  });

  it("rejects an unknown module", async () => {
    const { token } = await tenantLogin("TEN1", "t1");
    const res = await request(app).get("/v1/implementation/bogus").set(bearer(token));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_MODULE");
  });

  it("creates a record with a per-tenant PREFIX-#### code", async () => {
    const { token } = await tenantLogin("TEN1", "t1");
    const res = await request(app).post("/v1/implementation/documents").set(bearer(token))
      .send({ title: "Security Policy", status: "Active", data: { type: "Policy", version: "v1.0" } });
    expect(res.status).toBe(201);
    expect(res.body.data.code).toBe("DOC-0001");
    expect(res.body.data.module).toBe("documents");
    expect(res.body.data.data.type).toBe("Policy");
  });

  it("computes risk score and level from likelihood x impact", async () => {
    const { token } = await tenantLogin("TEN1", "t1");
    const res = await request(app).post("/v1/implementation/risks").set(bearer(token))
      .send({ title: "Phishing", data: { likelihood: 4, impact: 4, treatment: "Mitigate" } });
    expect(res.body.data.data.riskScore).toBe(16);
    expect(res.body.data.data.riskLevel).toBe("Major");
  });

  it("scopes records to the tenant; another tenant cannot see them", async () => {
    const a = await tenantLogin("TENA", "ua");
    const b = await tenantLogin("TENB", "ub");
    await request(app).post("/v1/implementation/risks").set(bearer(a.token)).send({ title: "A risk", data: {} });
    const aList = await request(app).get("/v1/implementation/risks").set(bearer(a.token));
    expect(aList.body.data).toHaveLength(1);
    const bList = await request(app).get("/v1/implementation/risks").set(bearer(b.token));
    expect(bList.body.data).toHaveLength(0);
  });

  it("updates and deletes a record", async () => {
    const { token } = await tenantLogin("TEN1", "t1");
    const created = await request(app).post("/v1/implementation/objectives").set(bearer(token)).send({ title: "Obj", data: { progress: 10 } });
    const id = created.body.data.id;
    const upd = await request(app).put(`/v1/implementation/objectives/${id}`).set(bearer(token)).send({ status: "Achieved", data: { progress: 100 } });
    expect(upd.body.data.status).toBe("Achieved");
    expect(upd.body.data.data.progress).toBe(100);
    const del = await request(app).delete(`/v1/implementation/objectives/${id}`).set(bearer(token));
    expect(del.status).toBe(200);
    const list = await request(app).get("/v1/implementation/objectives").set(bearer(token));
    expect(list.body.data).toHaveLength(0);
  });

  it("requires the Service Owner to pass orgId when creating", async () => {
    const so = await soLogin();
    const res = await request(app).post("/v1/implementation/risks").set(bearer(so)).send({ title: "x", data: {} });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("ORG_REQUIRED");
  });
});
