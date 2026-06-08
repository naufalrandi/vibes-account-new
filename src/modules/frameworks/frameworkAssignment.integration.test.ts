import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import { initModels, Framework, Organization, Site, User, Role } from "../../db/models";
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
    orgId: so.id, tenantId: null, fullName: "Admin", username: "soadmin", email: "soadmin@axia.io",
    passwordHash: await hashPassword("ChangeMe123"), status: "Active",
    position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null,
  });
  const role = await Role.create({ name: "SO Administrator", tierScope: "ServiceOwner", orgId: so.id, isSuperAdmin: true, status: true });
  await setRoles(admin, [role]);
  const login = await request(app).post("/v1/auth/login").send({ identifier: "soadmin", password: "ChangeMe123" });
  return login.body.data.accessToken;
}

async function makeTenant(code = "TEN1"): Promise<{ orgId: string; siteId: string; fwId: string }> {
  const t = await Organization.create({
    name: `Tenant ${code}`, code, type: "Tenant", status: "Active",
    parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: "ID", address: null,
  });
  const site = await Site.create({
    orgId: t.id, code: `STE-${code}`, name: "HQ", type: "Head Office", country: "ID", address: null,
    status: "Active", isPrimary: true, description: null, contactPerson: null, contactEmail: null, contactPhone: null,
  });
  const fw = await Framework.create({ groupId: null, name: `ISO ${code}`, description: null });
  return { orgId: t.id, siteId: site.id, fwId: fw.id };
}

describe("framework assignments", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("requires authentication", async () => {
    const res = await request(app).get("/v1/framework-assignments");
    expect(res.status).toBe(401);
  });

  it("assigns a framework to a site with an FA-#### code and joined names", async () => {
    const token = await soLogin();
    const { orgId, siteId, fwId } = await makeTenant();
    const res = await request(app).post("/v1/framework-assignments").set(bearer(token))
      .send({ orgId, siteId, frameworkId: fwId, status: "Active", assignedDate: "2026-02-01" });
    expect(res.status).toBe(201);
    expect(res.body.data.code).toMatch(/^FA-\d+$/);
    expect(res.body.data.siteName).toBe("HQ");
    expect(res.body.data.frameworkName).toBe("ISO TEN1");
    expect(res.body.data.status).toBe("Active");
  });

  it("prevents duplicate framework on the same site", async () => {
    const token = await soLogin();
    const { orgId, siteId, fwId } = await makeTenant();
    await request(app).post("/v1/framework-assignments").set(bearer(token)).send({ orgId, siteId, frameworkId: fwId });
    const dup = await request(app).post("/v1/framework-assignments").set(bearer(token)).send({ orgId, siteId, frameworkId: fwId });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("ASSIGNMENT_EXISTS");
  });

  it("rejects a site that does not belong to the tenant", async () => {
    const token = await soLogin();
    const a = await makeTenant("TENA");
    const b = await makeTenant("TENB");
    const res = await request(app).post("/v1/framework-assignments").set(bearer(token))
      .send({ orgId: a.orgId, siteId: b.siteId, frameworkId: a.fwId });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("SITE_ORG_MISMATCH");
  });

  it("updates status and lists by org filter", async () => {
    const token = await soLogin();
    const { orgId, siteId, fwId } = await makeTenant();
    const created = await request(app).post("/v1/framework-assignments").set(bearer(token)).send({ orgId, siteId, frameworkId: fwId });
    const id = created.body.data.id;
    const upd = await request(app).put(`/v1/framework-assignments/${id}`).set(bearer(token)).send({ status: "Suspended" });
    expect(upd.body.data.status).toBe("Suspended");
    const list = await request(app).get(`/v1/framework-assignments?orgId=${orgId}`).set(bearer(token));
    expect(list.body.data).toHaveLength(1);
  });

  it("deletes an assignment", async () => {
    const token = await soLogin();
    const { orgId, siteId, fwId } = await makeTenant();
    const created = await request(app).post("/v1/framework-assignments").set(bearer(token)).send({ orgId, siteId, frameworkId: fwId });
    const del = await request(app).delete(`/v1/framework-assignments/${created.body.data.id}`).set(bearer(token));
    expect(del.status).toBe(200);
    const list = await request(app).get("/v1/framework-assignments").set(bearer(token));
    expect(list.body.data).toHaveLength(0);
  });

  it("forbids a Distributor from reading an assignment for a tenant it does not parent", async () => {
    const soToken = await soLogin();
    // Two tenants: A is parented by the distributor, B is parented by the SO.
    const a = await makeTenant("TENA");
    const b = await makeTenant("TENB");
    const dist = await Organization.create({
      name: "NW", code: "NW", type: "Distributor", status: "Active",
      parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null,
    });
    await Organization.update({ parentOrgId: dist.id }, { where: { id: a.orgId } });

    const createdA = await request(app).post("/v1/framework-assignments").set(bearer(soToken)).send({ orgId: a.orgId, siteId: a.siteId, frameworkId: a.fwId });
    const createdB = await request(app).post("/v1/framework-assignments").set(bearer(soToken)).send({ orgId: b.orgId, siteId: b.siteId, frameworkId: b.fwId });

    const u = await User.create({
      orgId: dist.id, tenantId: null, fullName: "D", username: "duser", email: "d@nw.io",
      passwordHash: await hashPassword("ChangeMe123"), status: "Active",
      position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null,
    });
    const role = await Role.create({ name: "Dist Admin", tierScope: "Distributor", orgId: dist.id, isSuperAdmin: false, status: true });
    await setRoles(u, [role]);
    await grantActions(role.id, [ACTIONS.FRAMEWORK_ASSIGNMENT_READ]);
    const login = await request(app).post("/v1/auth/login").send({ identifier: "duser", password: "ChangeMe123" });
    const distToken = login.body.data.accessToken;

    const own = await request(app).get(`/v1/framework-assignments/${createdA.body.data.id}`).set(bearer(distToken));
    expect(own.status).toBe(200);
    const foreign = await request(app).get(`/v1/framework-assignments/${createdB.body.data.id}`).set(bearer(distToken));
    expect(foreign.status).toBe(404);
  });

  it("lets a tenant read only its own assignments but not write", async () => {
    const soToken = await soLogin();
    const { orgId, siteId, fwId } = await makeTenant("OWN");
    await request(app).post("/v1/framework-assignments").set(bearer(soToken)).send({ orgId, siteId, frameworkId: fwId });

    // A tenant user belonging to that org, with read + create grants.
    const tUser = await User.create({
      orgId, tenantId: orgId, fullName: "T", username: "town", email: "t@own.io",
      passwordHash: await hashPassword("ChangeMe123"), status: "Active",
      position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null,
    });
    const role = await Role.create({ name: "Tenant Admin", tierScope: "Tenant", orgId, isSuperAdmin: false, status: true });
    await setRoles(tUser, [role]);
    await grantActions(role.id, [ACTIONS.FRAMEWORK_ASSIGNMENT_READ, ACTIONS.FRAMEWORK_ASSIGNMENT_CREATE]);
    const login = await request(app).post("/v1/auth/login").send({ identifier: "town", password: "ChangeMe123" });
    const tToken = login.body.data.accessToken;

    const list = await request(app).get("/v1/framework-assignments").set(bearer(tToken));
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);

    // Tenants are not Service Owners → create is forbidden even with the grant.
    const create = await request(app).post("/v1/framework-assignments").set(bearer(tToken))
      .send({ orgId, siteId, frameworkId: fwId });
    expect(create.status).toBe(403);
  });
});
