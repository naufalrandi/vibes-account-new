import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import {
  initModels,
  Organization,
  User,
  Role,
  FrameworkType,
  FrameworkFamily,
  Framework,
  OrganizationFramework,
} from "../../db/models";
import { hashPassword } from "../../lib/password";
import { resetDb, grantActions } from "../../../test/helpers";
import { ACTIONS } from "../iam/actions.catalog";

const app = createApp();

/** A Tenant Administrator with the My Frameworks grants — the page's audience. */
async function adminLogin(username = "tenant", code = "ACME"): Promise<{ token: string; orgId: string }> {
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
  await grantActions(role.id, [ACTIONS.MY_FRAMEWORK_READ, ACTIONS.MY_FRAMEWORK_DELETE]);
  const login = await request(app).post("/v1/auth/login").send({ identifier: username, password: "ChangeMe123" });
  return { token: login.body.data.accessToken, orgId: tenant.id };
}

/** A Tenant user with NO My Frameworks grants — should be forbidden. */
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

/** Seed one framework under a family/type and return all the ids. */
async function seedFramework(code = "ISO27001"): Promise<{ frameworkId: string; familyId: string; typeId: string }> {
  const type = await FrameworkType.create({ code: `T-${code}`, name: "ISO Standards", description: "Intl", sortOrder: 1, status: "Active" });
  const family = await FrameworkFamily.create({ code: `F-${code}`, name: "ISO 27000 Series", frameworkTypeId: type.id, sortOrder: 1, status: "Active", description: "Infosec" });
  const framework = await Framework.create({
    familyId: family.id, code, name: "ISO 27001", version: "2022", status: "Published",
    publishedDate: null, shortDescription: "ISMS requirements", fullDescription: null,
  });
  return { frameworkId: framework.id, familyId: family.id, typeId: type.id };
}

describe("my frameworks", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("lists the org's subscriptions with framework, family, and type details", async () => {
    const { frameworkId, familyId, typeId } = await seedFramework();
    const { token, orgId } = await adminLogin();
    const sub = await OrganizationFramework.create({ orgId, frameworkId, subscribedByUserId: null });

    const res = await request(app).get("/v1/my-frameworks").set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({
      subscriptionId: sub.id,
      frameworkId,
      frameworkName: "ISO 27001",
      frameworkCode: "ISO27001",
      shortDescription: "ISMS requirements",
      familyId,
      familyName: "ISO 27000 Series",
      typeId,
      typeName: "ISO Standards",
      version: "2022",
      status: "Active",
    });
    expect(typeof res.body.data[0].activatedAt).toBe("string");
    expect(res.body.meta.total).toBe(1);
  });

  it("returns an empty list when the org has no subscriptions", async () => {
    await seedFramework();
    const { token } = await adminLogin();
    const res = await request(app).get("/v1/my-frameworks").set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it("scopes the list to the caller's organization", async () => {
    const { frameworkId } = await seedFramework();
    const orgOne = await adminLogin("admin1", "ORGONE");
    const orgTwo = await adminLogin("admin2", "ORGTWO");
    await OrganizationFramework.create({ orgId: orgOne.orgId, frameworkId, subscribedByUserId: null });

    const res = await request(app).get("/v1/my-frameworks").set("authorization", `Bearer ${orgTwo.token}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it("removes only the subscription record, leaving the framework catalog intact", async () => {
    const { frameworkId } = await seedFramework();
    const { token, orgId } = await adminLogin();
    const sub = await OrganizationFramework.create({ orgId, frameworkId, subscribedByUserId: null });

    const del = await request(app).delete(`/v1/my-frameworks/${sub.id}`).set("authorization", `Bearer ${token}`);
    expect(del.status).toBe(200);
    expect(del.body.data.id).toBe(sub.id);

    expect(await OrganizationFramework.findByPk(sub.id)).toBeNull();
    // The catalog framework must survive the unsubscribe.
    expect(await Framework.findByPk(frameworkId)).not.toBeNull();
  });

  it("returns 404 for an unknown subscription id", async () => {
    const { token } = await adminLogin();
    const res = await request(app)
      .delete("/v1/my-frameworks/00000000-0000-0000-0000-000000000000")
      .set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("SUBSCRIPTION_NOT_FOUND");
  });

  it("refuses to remove a subscription belonging to another organization", async () => {
    const { frameworkId } = await seedFramework();
    const orgOne = await adminLogin("admin1", "ORGONE");
    const orgTwo = await adminLogin("admin2", "ORGTWO");
    const sub = await OrganizationFramework.create({ orgId: orgOne.orgId, frameworkId, subscribedByUserId: null });

    const del = await request(app).delete(`/v1/my-frameworks/${sub.id}`).set("authorization", `Bearer ${orgTwo.token}`);
    expect(del.status).toBe(404);
    // The other org's subscription is untouched.
    expect(await OrganizationFramework.findByPk(sub.id)).not.toBeNull();
  });

  it("rejects a malformed subscription id with a 400 validation error", async () => {
    const { token } = await adminLogin();
    const res = await request(app).delete("/v1/my-frameworks/not-a-uuid").set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it("forbids actors without the My Frameworks grants", async () => {
    const token = await ungrantedLogin();
    const read = await request(app).get("/v1/my-frameworks").set("authorization", `Bearer ${token}`);
    expect(read.status).toBe(403);
  });

  it("requires authentication", async () => {
    const res = await request(app).get("/v1/my-frameworks");
    expect(res.status).toBe(401);
  });
});
