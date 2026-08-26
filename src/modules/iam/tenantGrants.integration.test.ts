import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import { initModels, Organization, User, Role, RoleActionGrant, Action } from "../../db/models";
import { hashPassword } from "../../lib/password";
import { resetDb, grantActions, seedActionCatalog } from "../../../test/helpers";
import { ACTIONS } from "./actions.catalog";

const app = createApp();
const authed = (t: string) => ({ Authorization: `Bearer ${t}` });

/**
 * P0 (§2 task 2 of the 2026-08-18 gap analysis): both live tenant-provisioning
 * paths — `tenant.service.ts` `provisionTenant` (direct SP provisioning) and
 * `registration.service.ts` `approveRegistration` (Distributor request → SP
 * approval) — used to create the new tenant's admin `User` with NO `Role` at
 * all, so the account could authenticate but every authorized request 403d
 * (zero action grants). Both now create an "Administrator" role via the
 * shared `grantEverythingExceptSpOnly` helper (`./tenantGrants.ts`), the same
 * curated non-SP grant set `src/db/seeders/seed.ts` gives its demo
 * Distributor/Tenant admins.
 */

async function makeServiceOwner(actions: string[]): Promise<{ token: string }> {
  const org = await Organization.create({
    name: "AXIA", code: "AXIA", type: "ServiceOwner", status: "Active",
    parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null,
  });
  const user = await User.create({
    orgId: org.id, tenantId: null, fullName: "SO Admin", username: "soadmin", email: "soadmin@axia.io",
    passwordHash: await hashPassword("ChangeMe123"), status: "Active",
    position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null,
  });
  const role = await Role.create({ name: "SO", tierScope: "ServiceOwner", orgId: org.id, isSuperAdmin: false, status: true });
  await (user as unknown as { setRoles: (r: Role[]) => Promise<unknown> }).setRoles([role]);
  await grantActions(role.id, actions);
  const login = await request(app).post("/v1/auth/login").send({ identifier: "soadmin", password: "ChangeMe123" });
  return { token: login.body.data.accessToken };
}

/** Activate a PendingActivation user by its activation token and log in. */
async function activateAndLogin(username: string, token: string): Promise<string> {
  const activateRes = await request(app).post("/v1/auth/activate").send({ token, password: "NewPass123!" });
  expect(activateRes.status).toBe(200);
  const login = await request(app).post("/v1/auth/login").send({ identifier: username, password: "NewPass123!" });
  expect(login.status).toBe(200);
  return login.body.data.accessToken as string;
}

describe("tenant provisioning grants (P0: new tenant admin gets an Administrator role)", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("provisionTenant creates an Administrator role granting the curated non-SP action set", async () => {
    await seedActionCatalog();
    const { token } = await makeServiceOwner([ACTIONS.TENANT_CREATE]);

    const res = await request(app).post("/v1/tenants").set(authed(token)).send({
      organization: { name: "Acme", industry: "Manufacturing", country: "ID" },
      primarySite: { name: "Acme HQ", type: "Head Office", country: "ID" },
      admin: { fullName: "Acme Admin", username: "acme.admin", email: "admin@acme.io" },
      mode: "activate",
    });
    expect(res.status).toBe(201);

    const org = await Organization.findByPk(res.body.data.id);
    expect(org).not.toBeNull();
    const role = await Role.findOne({ where: { orgId: org!.id, name: "Administrator" } });
    expect(role).not.toBeNull();
    expect(role!.tierScope).toBe("Tenant");

    // Curated set: a representative granted action + a representative SP-only
    // action that must NOT be granted (mirrors seed.ts's SP_ONLY_ACTIONS).
    const grants = await RoleActionGrant.findAll({ where: { roleId: role!.id }, include: [Action] });
    const grantedKeys = new Set(grants.map((g) => (g.get("Action") as Action).key));
    expect(grantedKeys.has(ACTIONS.SITE_READ)).toBe(true);
    expect(grantedKeys.has(ACTIONS.MS_READ)).toBe(true);
    expect(grantedKeys.has(ACTIONS.FRAMEWORK_CREATE)).toBe(false);
    expect(grantedKeys.has(ACTIONS.TICKET_MANAGE)).toBe(false);
    expect(grantedKeys.has(ACTIONS.TENANT_CREATE)).toBe(false);

    // The activation token was issued because mode: "activate" — pull it
    // straight from the row (the notification send is a stub in tests).
    const admin = await User.findOne({ where: { username: "acme.admin" } });
    expect(admin).not.toBeNull();
    const adminToken = await activateAndLogin("acme.admin", admin!.activationToken!);

    // The new tenant admin can now use a curated action…
    const siteList = await request(app).get("/v1/sites").set(authed(adminToken));
    expect(siteList.status).toBe(200);
    // …but is still forbidden from an SP-only action (defence-in-depth: the
    // route itself rejects it even though the FE never renders the control).
    const frameworkCreate = await request(app)
      .post("/v1/frameworks")
      .set(authed(adminToken))
      .send({ name: "Should be rejected" });
    expect(frameworkCreate.status).toBe(403);
  });

  it("approveRegistration (Distributor request → SP approval) creates the same curated Administrator role", async () => {
    await seedActionCatalog();
    const { token: soToken } = await makeServiceOwner([ACTIONS.REGISTRATION_DECIDE, ACTIONS.REGISTRATION_SUBMIT]);

    // A Distributor submits a tenant request.
    const distributor = await Organization.create({
      name: "Nusantara Partners", code: "NPART", type: "Distributor", status: "Active",
      parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null,
    });
    const distUser = await User.create({
      orgId: distributor.id, tenantId: null, fullName: "Partner Admin", username: "partner.admin", email: "partner@nusantara.id",
      passwordHash: await hashPassword("ChangeMe123"), status: "Active",
      position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null,
    });
    const distRole = await Role.create({ name: "Administrator", tierScope: "Distributor", orgId: distributor.id, isSuperAdmin: false, status: true });
    await (distUser as unknown as { setRoles: (r: Role[]) => Promise<unknown> }).setRoles([distRole]);
    await grantActions(distRole.id, [ACTIONS.REGISTRATION_SUBMIT]);
    const distLogin = await request(app).post("/v1/auth/login").send({ identifier: "partner.admin", password: "ChangeMe123" });
    const distToken = distLogin.body.data.accessToken;

    const submitRes = await request(app).post("/v1/registration-requests").set(authed(distToken)).send({
      name: "Garuda Manufacturing", code: "GARUDA2",
      adminFullName: "Garuda Admin", adminUsername: "garuda.admin", adminEmail: "admin@garuda.id",
    });
    expect(submitRes.status).toBe(201);

    const approveRes = await request(app).post(`/v1/registration-requests/${submitRes.body.data.id}/approve`).set(authed(soToken));
    expect(approveRes.status).toBe(201);
    const tenantId = approveRes.body.data.tenantId as string;
    expect(tenantId).toBeTruthy();

    const role = await Role.findOne({ where: { orgId: tenantId, name: "Administrator" } });
    expect(role).not.toBeNull();
    const grants = await RoleActionGrant.findAll({ where: { roleId: role!.id }, include: [Action] });
    const grantedKeys = new Set(grants.map((g) => (g.get("Action") as Action).key));
    expect(grantedKeys.has(ACTIONS.USER_READ)).toBe(true);
    expect(grantedKeys.has(ACTIONS.FRAMEWORK_CREATE)).toBe(false);

    const admin = await User.findOne({ where: { username: "garuda.admin" } });
    expect(admin).not.toBeNull();
    const adminToken = await activateAndLogin("garuda.admin", admin!.activationToken!);
    const usersList = await request(app).get("/v1/users").set(authed(adminToken));
    expect(usersList.status).toBe(200);
  });
});
