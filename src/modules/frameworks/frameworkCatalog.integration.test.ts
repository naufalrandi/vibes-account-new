import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import { initModels, Organization, User, Role } from "../../db/models";
import { hashPassword } from "../../lib/password";
import { resetDb, grantActions } from "../../../test/helpers";
import { ACTIONS } from "../iam/actions.catalog";

const app = createApp();

/** A Service-Owner admin (super-admin) used to seed the master catalog. */
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

/** A Tenant Administrator with the catalog grants — the catalog's intended audience. */
async function tenantAdminLogin(username = "tenant", code = "ACME"): Promise<string> {
  const tenant = await Organization.create({
    name: code, code, type: "Tenant", status: "Active",
    parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null,
  });
  const user = await User.create({
    orgId: tenant.id, tenantId: tenant.id, fullName: "Tenant Admin", username, email: `${username}@acme.io`,
    passwordHash: await hashPassword("ChangeMe123"), status: "Active",
    position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null,
  });
  const role = await Role.create({ name: "Administrator", tierScope: "Tenant", orgId: tenant.id, isSuperAdmin: false, status: true });
  await (user as unknown as { setRoles: (roles: Role[]) => Promise<unknown> }).setRoles([role]);
  await grantActions(role.id, [ACTIONS.FRAMEWORK_CATALOG_READ, ACTIONS.FRAMEWORK_CATALOG_SUBSCRIBE]);
  const login = await request(app).post("/v1/auth/login").send({ identifier: username, password: "ChangeMe123" });
  return login.body.data.accessToken;
}

/** A Tenant user with NO catalog grants — should be forbidden. */
async function ungrantedLogin(): Promise<string> {
  const tenant = await Organization.create({
    name: "NoGrant", code: "NOGRANT", type: "Tenant", status: "Active",
    parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null,
  });
  const user = await User.create({
    orgId: tenant.id, tenantId: tenant.id, fullName: "Plain User", username: "plain", email: "plain@nogrant.io",
    passwordHash: await hashPassword("ChangeMe123"), status: "Active",
    position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null,
  });
  const role = await Role.create({ name: "User", tierScope: "Tenant", orgId: tenant.id, isSuperAdmin: false, status: true });
  await (user as unknown as { setRoles: (roles: Role[]) => Promise<unknown> }).setRoles([role]);
  const login = await request(app).post("/v1/auth/login").send({ identifier: "plain", password: "ChangeMe123" });
  return login.body.data.accessToken;
}

async function seedCatalog(token: string): Promise<{ familyId: string; fwA: string; fwB: string }> {
  const typeRes = await request(app).post("/v1/framework-types").set("authorization", `Bearer ${token}`)
    .send({ code: "ISO", name: "ISO Standards", description: "International standards" });
  const typeId = typeRes.body.data.id as string;
  const famRes = await request(app).post("/v1/framework-families").set("authorization", `Bearer ${token}`)
    .send({ code: "ISO27K", name: "ISO 27000 Series", frameworkTypeId: typeId, description: "Infosec family" });
  const familyId = famRes.body.data.id as string;
  const a = await request(app).post("/v1/frameworks").set("authorization", `Bearer ${token}`)
    .send({ code: "ISO27001", name: "ISO 27001", familyId, version: "2022", status: "Published", shortDescription: "ISMS requirements" });
  const b = await request(app).post("/v1/frameworks").set("authorization", `Bearer ${token}`)
    .send({ code: "ISO27002", name: "ISO 27002", familyId, version: "2022", status: "Published", shortDescription: "Controls" });
  return { familyId, fwA: a.body.data.id as string, fwB: b.body.data.id as string };
}

describe("framework catalog", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("returns the hierarchical catalog with isSubscribed=false initially", async () => {
    const soToken = await soLogin();
    await seedCatalog(soToken);
    const token = await tenantAdminLogin();

    const res = await request(app).get("/v1/framework-catalog").set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    const type = res.body.data[0];
    expect(type.name).toBe("ISO Standards");
    expect(type.frameworkCount).toBe(2);
    expect(type.families).toHaveLength(1);
    const family = type.families[0];
    expect(family.name).toBe("ISO 27000 Series");
    expect(family.frameworkCount).toBe(2);
    expect(family.frameworks.map((f: { code: string }) => f.code)).toEqual(["ISO27001", "ISO27002"]);
    expect(family.frameworks.every((f: { isSubscribed: boolean }) => f.isSubscribed === false)).toBe(true);
    expect(family.frameworks[0]).toMatchObject({ name: "ISO 27001", version: "2022", shortDescription: "ISMS requirements" });
  });

  it("subscribes to a framework and reflects isSubscribed=true on the next catalog read", async () => {
    const soToken = await soLogin();
    const { fwA } = await seedCatalog(soToken);
    const token = await tenantAdminLogin();

    const sub = await request(app).post(`/v1/framework-catalog/${fwA}/subscribe`).set("authorization", `Bearer ${token}`);
    expect(sub.status).toBe(201);
    expect(sub.body.data.frameworkId).toBe(fwA);

    const res = await request(app).get("/v1/framework-catalog").set("authorization", `Bearer ${token}`);
    const frameworks = res.body.data[0].families[0].frameworks as { id: string; isSubscribed: boolean }[];
    expect(frameworks.find((f) => f.id === fwA)?.isSubscribed).toBe(true);
    expect(frameworks.filter((f) => f.isSubscribed)).toHaveLength(1);
  });

  it("rejects a duplicate subscription with ALREADY_SUBSCRIBED", async () => {
    const soToken = await soLogin();
    const { fwA } = await seedCatalog(soToken);
    const token = await tenantAdminLogin();

    await request(app).post(`/v1/framework-catalog/${fwA}/subscribe`).set("authorization", `Bearer ${token}`);
    const dup = await request(app).post(`/v1/framework-catalog/${fwA}/subscribe`).set("authorization", `Bearer ${token}`);
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("ALREADY_SUBSCRIBED");
  });

  it("scopes isSubscribed per organization", async () => {
    const soToken = await soLogin();
    const { fwA } = await seedCatalog(soToken);
    const orgOne = await tenantAdminLogin("admin1", "ORGONE");
    const orgTwo = await tenantAdminLogin("admin2", "ORGTWO");

    await request(app).post(`/v1/framework-catalog/${fwA}/subscribe`).set("authorization", `Bearer ${orgOne}`);

    const resTwo = await request(app).get("/v1/framework-catalog").set("authorization", `Bearer ${orgTwo}`);
    const frameworksTwo = resTwo.body.data[0].families[0].frameworks as { isSubscribed: boolean }[];
    expect(frameworksTwo.every((f) => f.isSubscribed === false)).toBe(true);
  });

  it("rejects subscribing to an unknown framework with 404", async () => {
    const token = await tenantAdminLogin();
    const res = await request(app).post("/v1/framework-catalog/00000000-0000-0000-0000-000000000000/subscribe")
      .set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("FRAMEWORK_NOT_FOUND");
  });

  it("rejects a malformed framework id with a 400 validation error", async () => {
    const token = await tenantAdminLogin();
    const res = await request(app).post("/v1/framework-catalog/not-a-uuid/subscribe")
      .set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it("forbids actors without the catalog grants", async () => {
    const token = await ungrantedLogin();
    const read = await request(app).get("/v1/framework-catalog").set("authorization", `Bearer ${token}`);
    expect(read.status).toBe(403);
  });

  it("requires authentication", async () => {
    const res = await request(app).get("/v1/framework-catalog");
    expect(res.status).toBe(401);
  });
});
