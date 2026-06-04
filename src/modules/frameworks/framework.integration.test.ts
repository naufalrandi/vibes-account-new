import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import { initModels, Organization, User, Role } from "../../db/models";
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

/** A Tenant-scoped user that has the framework grants but the wrong org type. */
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
    ACTIONS.FRAMEWORK_READ,
    ACTIONS.FRAMEWORK_CREATE,
    ACTIONS.FRAMEWORK_UPDATE,
    ACTIONS.FRAMEWORK_DELETE,
  ]);
  const login = await request(app).post("/v1/auth/login").send({ identifier: "tenant", password: "ChangeMe123" });
  return login.body.data.accessToken;
}

async function createType(token: string, code: string, name: string): Promise<string> {
  const res = await request(app).post("/v1/framework-types").set("authorization", `Bearer ${token}`).send({ code, name });
  return res.body.data.id as string;
}

async function createFamily(token: string, typeId: string, code: string, name: string): Promise<string> {
  const res = await request(app).post("/v1/framework-families").set("authorization", `Bearer ${token}`)
    .send({ code, name, frameworkTypeId: typeId });
  return res.body.data.id as string;
}

async function seedFamily(token: string): Promise<string> {
  const typeId = await createType(token, "ISO27001", "ISO 27001");
  return createFamily(token, typeId, "AC", "Access Control");
}

describe("frameworks", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("creates a framework and lists it with its family + type included", async () => {
    const token = await soLogin();
    const familyId = await seedFamily(token);
    const res = await request(app).post("/v1/frameworks").set("authorization", `Bearer ${token}`).send({
      code: "AC-1", name: "Access Control Baseline", familyId,
      version: "1.0", status: "Published", publishedDate: "2026-01-15",
      shortDescription: "Baseline controls", fullDescription: "The full set of baseline access controls.",
    });
    expect(res.status).toBe(201);
    expect(res.body.data.code).toBe("AC-1");
    expect(res.body.data.status).toBe("Published");
    expect(res.body.data.FrameworkFamily.name).toBe("Access Control");
    expect(res.body.data.FrameworkFamily.FrameworkType.code).toBe("ISO27001");

    const list = await request(app).get("/v1/frameworks").set("authorization", `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].FrameworkFamily.FrameworkType.name).toBe("ISO 27001");
  });

  it("defaults status to Draft when omitted", async () => {
    const token = await soLogin();
    const familyId = await seedFamily(token);
    const res = await request(app).post("/v1/frameworks").set("authorization", `Bearer ${token}`)
      .send({ code: "F1", name: "Framework One", familyId });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe("Draft");
  });

  it("rejects a duplicate code", async () => {
    const token = await soLogin();
    const familyId = await seedFamily(token);
    await request(app).post("/v1/frameworks").set("authorization", `Bearer ${token}`)
      .send({ code: "DUP", name: "First", familyId });
    const res = await request(app).post("/v1/frameworks").set("authorization", `Bearer ${token}`)
      .send({ code: "DUP", name: "Second", familyId });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("DUPLICATE_CODE");
  });

  it("rejects an unknown family on create", async () => {
    const token = await soLogin();
    const res = await request(app).post("/v1/frameworks").set("authorization", `Bearer ${token}`)
      .send({ code: "X", name: "X", familyId: "00000000-0000-0000-0000-000000000000" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("FRAMEWORK_FAMILY_NOT_FOUND");
  });

  it("updates a framework and reflects the change in the response", async () => {
    const token = await soLogin();
    const familyId = await seedFamily(token);
    const created = await request(app).post("/v1/frameworks").set("authorization", `Bearer ${token}`)
      .send({ code: "U1", name: "Old Name", familyId });
    const res = await request(app).put(`/v1/frameworks/${created.body.data.id}`).set("authorization", `Bearer ${token}`)
      .send({ name: "New Name", status: "Archived" });
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe("New Name");
    expect(res.body.data.status).toBe("Archived");
    expect(res.body.data.FrameworkFamily.code).toBe("AC");
  });

  it("filters frameworks by family id", async () => {
    const token = await soLogin();
    const typeId = await createType(token, "T", "Type");
    const famA = await createFamily(token, typeId, "FA", "Family A");
    const famB = await createFamily(token, typeId, "FB", "Family B");
    await request(app).post("/v1/frameworks").set("authorization", `Bearer ${token}`).send({ code: "A1", name: "A1", familyId: famA });
    await request(app).post("/v1/frameworks").set("authorization", `Bearer ${token}`).send({ code: "B1", name: "B1", familyId: famB });
    const list = await request(app).get(`/v1/frameworks?familyId=${famA}`).set("authorization", `Bearer ${token}`);
    expect(list.body.data.map((f: { code: string }) => f.code)).toEqual(["A1"]);
  });

  it("deletes a framework", async () => {
    const token = await soLogin();
    const familyId = await seedFamily(token);
    const created = await request(app).post("/v1/frameworks").set("authorization", `Bearer ${token}`)
      .send({ code: "D1", name: "Doomed", familyId });
    const del = await request(app).delete(`/v1/frameworks/${created.body.data.id}`).set("authorization", `Bearer ${token}`);
    expect(del.status).toBe(200);
    const list = await request(app).get("/v1/frameworks").set("authorization", `Bearer ${token}`);
    expect(list.body.data).toHaveLength(0);
  });

  it("returns FRAMEWORK_NOT_FOUND for a missing framework", async () => {
    const token = await soLogin();
    const res = await request(app).get("/v1/frameworks/00000000-0000-0000-0000-000000000000")
      .set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("FRAMEWORK_NOT_FOUND");
  });

  it("forbids non-Service-Owner actors even with action grants", async () => {
    const soToken = await soLogin();
    const familyId = await seedFamily(soToken);
    const token = await tenantLogin();
    const res = await request(app).post("/v1/frameworks").set("authorization", `Bearer ${token}`)
      .send({ code: "NOPE", name: "Nope", familyId });
    expect(res.status).toBe(403);
  });

  it("requires authentication", async () => {
    const res = await request(app).get("/v1/frameworks");
    expect(res.status).toBe(401);
  });
});
