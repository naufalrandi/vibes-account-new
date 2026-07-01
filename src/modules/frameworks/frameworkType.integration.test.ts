import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import { initModels, Organization, User, Role, FrameworkType, FrameworkFamily } from "../../db/models";
import { hashPassword } from "../../lib/password";
import { resetDb, grantActions } from "../../../test/helpers";
import { ACTIONS } from "../iam/actions.catalog";

const app = createApp();

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

/** A Tenant-scoped user that has the framework action grants but the wrong org type. */
async function tenantLogin(): Promise<string> {
  const tenant = await Organization.create({
    name: "Acme", code: "ACME", type: "Tenant", status: "Active",
    parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null,
  });
  const user = await User.create({
    orgId: tenant.id, tenantId: tenant.id, fullName: "Tenant Admin", username: "tenant", email: "tenant@acme.io",
    passwordHash: await hashPassword("ChangeMe123"), status: "Active",
    position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null,
  });
  const role = await Role.create({ name: "Tenant Admin", tierScope: "Tenant", orgId: tenant.id, isSuperAdmin: false, status: true });
  await (user as unknown as { setRoles: (roles: Role[]) => Promise<unknown> }).setRoles([role]);
  await grantActions(role.id, [
    ACTIONS.FRAMEWORK_TYPE_READ,
    ACTIONS.FRAMEWORK_TYPE_CREATE,
    ACTIONS.FRAMEWORK_TYPE_UPDATE,
    ACTIONS.FRAMEWORK_TYPE_DELETE,
  ]);
  const login = await request(app).post("/v1/auth/login").send({ identifier: "tenant", password: "ChangeMe123" });
  return login.body.data.accessToken;
}

describe("framework types", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("creates a framework type and lists it", async () => {
    const token = await soLogin();
    const res = await request(app).post("/v1/framework-types").set("authorization", `Bearer ${token}`)
      .send({ code: "ISO27001", name: "ISO 27001", description: "Infosec", sortOrder: 2, status: "Active" });
    expect(res.status).toBe(201);
    expect(res.body.data.code).toBe("ISO27001");

    const list = await request(app).get("/v1/framework-types").set("authorization", `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].sortOrder).toBe(2);
  });

  it("lists framework types sorted by sortOrder ascending", async () => {
    const token = await soLogin();
    await request(app).post("/v1/framework-types").set("authorization", `Bearer ${token}`)
      .send({ code: "B", name: "Bravo", sortOrder: 5 });
    await request(app).post("/v1/framework-types").set("authorization", `Bearer ${token}`)
      .send({ code: "A", name: "Alpha", sortOrder: 1 });
    const list = await request(app).get("/v1/framework-types").set("authorization", `Bearer ${token}`);
    expect(list.body.data.map((t: { code: string }) => t.code)).toEqual(["A", "B"]);
  });

  it("rejects a duplicate code", async () => {
    const token = await soLogin();
    await request(app).post("/v1/framework-types").set("authorization", `Bearer ${token}`)
      .send({ code: "DUP", name: "First" });
    const res = await request(app).post("/v1/framework-types").set("authorization", `Bearer ${token}`)
      .send({ code: "DUP", name: "Second" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("DUPLICATE_CODE");
  });

  it("validates required fields", async () => {
    const token = await soLogin();
    const res = await request(app).post("/v1/framework-types").set("authorization", `Bearer ${token}`)
      .send({ name: "No code" });
    expect(res.status).toBe(400);
  });

  it("updates a framework type", async () => {
    const token = await soLogin();
    const created = await request(app).post("/v1/framework-types").set("authorization", `Bearer ${token}`)
      .send({ code: "SOC2", name: "SOC 2" });
    const res = await request(app).put(`/v1/framework-types/${created.body.data.id}`).set("authorization", `Bearer ${token}`)
      .send({ name: "SOC 2 Type II", status: "Inactive", sortOrder: 9 });
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe("SOC 2 Type II");
    expect(res.body.data.status).toBe("Inactive");
    expect(res.body.data.sortOrder).toBe(9);
  });

  it("deletes a framework type with no linked families", async () => {
    const token = await soLogin();
    const created = await request(app).post("/v1/framework-types").set("authorization", `Bearer ${token}`)
      .send({ code: "GDPR", name: "GDPR" });
    const res = await request(app).delete(`/v1/framework-types/${created.body.data.id}`).set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    const list = await request(app).get("/v1/framework-types").set("authorization", `Bearer ${token}`);
    expect(list.body.data).toHaveLength(0);
  });

  it("prevents deletion when framework families are linked", async () => {
    const token = await soLogin();
    const created = await request(app).post("/v1/framework-types").set("authorization", `Bearer ${token}`)
      .send({ code: "NIST", name: "NIST CSF" });
    await FrameworkFamily.create({ frameworkTypeId: created.body.data.id, code: "NIST-AC", name: "Access Control" });

    const res = await request(app).delete(`/v1/framework-types/${created.body.data.id}`).set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("FRAMEWORK_TYPE_IN_USE");
    expect(await FrameworkType.count()).toBe(1);
  });

  it("returns FRAMEWORK_TYPE_NOT_FOUND for a missing type", async () => {
    const token = await soLogin();
    const res = await request(app).put("/v1/framework-types/00000000-0000-0000-0000-000000000000")
      .set("authorization", `Bearer ${token}`).send({ name: "X" });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("FRAMEWORK_TYPE_NOT_FOUND");
  });

  it("forbids non-Service-Owner actors even with action grants", async () => {
    const token = await tenantLogin();
    const res = await request(app).get("/v1/framework-types").set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it("requires authentication", async () => {
    const res = await request(app).get("/v1/framework-types");
    expect(res.status).toBe(401);
  });
});
