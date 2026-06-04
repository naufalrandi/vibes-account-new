import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import { initModels, Organization, User, Role, FrameworkType, FrameworkFamily, Framework } from "../../db/models";
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

/** A Tenant-scoped user that has the framework-family grants but the wrong org type. */
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
    ACTIONS.FRAMEWORK_FAMILY_READ,
    ACTIONS.FRAMEWORK_FAMILY_CREATE,
    ACTIONS.FRAMEWORK_FAMILY_UPDATE,
    ACTIONS.FRAMEWORK_FAMILY_DELETE,
  ]);
  const login = await request(app).post("/v1/auth/login").send({ identifier: "tenant", password: "ChangeMe123" });
  return login.body.data.accessToken;
}

async function createType(token: string, code: string, name: string): Promise<string> {
  const res = await request(app).post("/v1/framework-types").set("authorization", `Bearer ${token}`)
    .send({ code, name });
  return res.body.data.id as string;
}

describe("framework families", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("creates a family and lists it with its parent type included", async () => {
    const token = await soLogin();
    const typeId = await createType(token, "ISO27001", "ISO 27001");
    const res = await request(app).post("/v1/framework-families").set("authorization", `Bearer ${token}`)
      .send({ code: "AC", name: "Access Control", frameworkTypeId: typeId, sortOrder: 2, description: "Controls" });
    expect(res.status).toBe(201);
    expect(res.body.data.code).toBe("AC");
    expect(res.body.data.FrameworkType.name).toBe("ISO 27001");

    const list = await request(app).get("/v1/framework-families").set("authorization", `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].FrameworkType.code).toBe("ISO27001");
  });

  it("lists families sorted by sortOrder ascending", async () => {
    const token = await soLogin();
    const typeId = await createType(token, "T", "Type");
    await request(app).post("/v1/framework-families").set("authorization", `Bearer ${token}`)
      .send({ code: "B", name: "Bravo", frameworkTypeId: typeId, sortOrder: 5 });
    await request(app).post("/v1/framework-families").set("authorization", `Bearer ${token}`)
      .send({ code: "A", name: "Alpha", frameworkTypeId: typeId, sortOrder: 1 });
    const list = await request(app).get("/v1/framework-families").set("authorization", `Bearer ${token}`);
    expect(list.body.data.map((f: { code: string }) => f.code)).toEqual(["A", "B"]);
  });

  it("filters families by type id", async () => {
    const token = await soLogin();
    const typeA = await createType(token, "TA", "Type A");
    const typeB = await createType(token, "TB", "Type B");
    await request(app).post("/v1/framework-families").set("authorization", `Bearer ${token}`)
      .send({ code: "FA", name: "Fam A", frameworkTypeId: typeA });
    await request(app).post("/v1/framework-families").set("authorization", `Bearer ${token}`)
      .send({ code: "FB", name: "Fam B", frameworkTypeId: typeB });

    const list = await request(app).get(`/v1/framework-families?typeId=${typeA}`).set("authorization", `Bearer ${token}`);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].code).toBe("FA");
  });

  it("rejects a duplicate code", async () => {
    const token = await soLogin();
    const typeId = await createType(token, "T", "Type");
    await request(app).post("/v1/framework-families").set("authorization", `Bearer ${token}`)
      .send({ code: "DUP", name: "First", frameworkTypeId: typeId });
    const res = await request(app).post("/v1/framework-families").set("authorization", `Bearer ${token}`)
      .send({ code: "DUP", name: "Second", frameworkTypeId: typeId });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("DUPLICATE_CODE");
  });

  it("rejects a family pointing at a non-existent type", async () => {
    const token = await soLogin();
    const res = await request(app).post("/v1/framework-families").set("authorization", `Bearer ${token}`)
      .send({ code: "X", name: "Orphan", frameworkTypeId: "00000000-0000-0000-0000-000000000000" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("FRAMEWORK_TYPE_NOT_FOUND");
  });

  it("validates required fields", async () => {
    const token = await soLogin();
    const res = await request(app).post("/v1/framework-families").set("authorization", `Bearer ${token}`)
      .send({ name: "No code or type" });
    expect(res.status).toBe(400);
  });

  it("updates a family", async () => {
    const token = await soLogin();
    const typeId = await createType(token, "T", "Type");
    const created = await request(app).post("/v1/framework-families").set("authorization", `Bearer ${token}`)
      .send({ code: "F1", name: "Fam", frameworkTypeId: typeId });
    const res = await request(app).put(`/v1/framework-families/${created.body.data.id}`).set("authorization", `Bearer ${token}`)
      .send({ name: "Renamed", status: "Inactive", sortOrder: 7 });
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe("Renamed");
    expect(res.body.data.status).toBe("Inactive");
    expect(res.body.data.sortOrder).toBe(7);
  });

  it("deletes a family with no linked frameworks", async () => {
    const token = await soLogin();
    const typeId = await createType(token, "T", "Type");
    const created = await request(app).post("/v1/framework-families").set("authorization", `Bearer ${token}`)
      .send({ code: "F1", name: "Fam", frameworkTypeId: typeId });
    const res = await request(app).delete(`/v1/framework-families/${created.body.data.id}`).set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(await FrameworkFamily.count()).toBe(0);
  });

  it("prevents deletion when frameworks are linked", async () => {
    const token = await soLogin();
    const typeId = await createType(token, "T", "Type");
    const created = await request(app).post("/v1/framework-families").set("authorization", `Bearer ${token}`)
      .send({ code: "F1", name: "Fam", frameworkTypeId: typeId });
    await Framework.create({ familyId: created.body.data.id, code: "FW1", name: "A framework" });

    const res = await request(app).delete(`/v1/framework-families/${created.body.data.id}`).set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("FRAMEWORK_FAMILY_IN_USE");
    expect(await FrameworkFamily.count()).toBe(1);
  });

  it("returns FRAMEWORK_FAMILY_NOT_FOUND for a missing family", async () => {
    const token = await soLogin();
    const res = await request(app).put("/v1/framework-families/00000000-0000-0000-0000-000000000000")
      .set("authorization", `Bearer ${token}`).send({ name: "X" });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("FRAMEWORK_FAMILY_NOT_FOUND");
  });

  it("forbids non-Service-Owner actors even with action grants", async () => {
    const token = await tenantLogin();
    const res = await request(app).get("/v1/framework-families").set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it("requires authentication", async () => {
    const res = await request(app).get("/v1/framework-families");
    expect(res.status).toBe(401);
  });
});
