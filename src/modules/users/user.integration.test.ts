import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import { initModels, Organization, User, Role, Site } from "../../db/models";
import { hashPassword } from "../../lib/password";
import { resetDb, grantActions } from "../../../test/helpers";
import { ACTIONS } from "../iam/actions.catalog";

const app = createApp();

async function seedAdminAndLogin(): Promise<{ token: string; tenantOrgId: string }> {
  const so = await Organization.create({
    name: "AXIA", code: "AXIA", type: "ServiceOwner", status: "Active",
    parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null,
  });
  const tenant = await Organization.create({
    name: "Acme", code: "ACME", type: "Tenant", status: "Active",
    parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null,
  });
  tenant.tenantId = tenant.id;
  await tenant.save();

  const admin = await User.create({
    orgId: so.id, tenantId: null, fullName: "Admin", username: "soadmin", email: "soadmin@axia.io",
    passwordHash: await hashPassword("ChangeMe123"), status: "Active",
    position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null,
  });
  // SO Administrator is a super-admin → bypasses requireAction for all user routes.
  const role = await Role.create({ name: "SO Administrator", tierScope: "ServiceOwner", orgId: so.id, isSuperAdmin: true, status: true });
  // belongsToMany generates a `setRoles` mixin at runtime; `.set("Roles", ...)` is the
  // generic attribute setter and does NOT persist the association (matches seed.ts).
  await (admin as unknown as { setRoles: (roles: Role[]) => Promise<unknown> }).setRoles([role]);

  const login = await request(app).post("/v1/auth/login").send({ identifier: "soadmin", password: "ChangeMe123" });
  return { token: login.body.data.accessToken, tenantOrgId: tenant.id };
}

/**
 * A non-super Distributor admin (with user-management grants) plus an
 * out-of-scope target user living in the ServiceOwner org. Used to prove the
 * per-user mutations reject cross-org access for a Distributor actor.
 */
async function seedDistributorActor(): Promise<{ token: string; outOfScopeUserId: string }> {
  const so = await Organization.create({
    name: "AXIA", code: "AXIA", type: "ServiceOwner", status: "Active",
    parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null,
  });
  const dist = await Organization.create({
    name: "Northwind", code: "NWP", type: "Distributor", status: "Active",
    parentOrgId: so.id, tenantId: null, email: null, phone: null, website: null, country: null, address: null,
  });
  const soUser = await User.create({
    orgId: so.id, tenantId: null, fullName: "SO Person", username: "soperson", email: "soperson@axia.io",
    passwordHash: null, status: "Active", position: null, workUnit: null, lastLogin: null,
    activationToken: null, resetToken: null, resetExpires: null,
  });
  const distAdmin = await User.create({
    orgId: dist.id, tenantId: null, fullName: "Dist Admin", username: "distadmin", email: "da@nwp.io",
    passwordHash: await hashPassword("ChangeMe123"), status: "Active", position: null, workUnit: null,
    lastLogin: null, activationToken: null, resetToken: null, resetExpires: null,
  });
  const role = await Role.create({ name: "Administrator", tierScope: "Distributor", orgId: dist.id, isSuperAdmin: false, status: true });
  await (distAdmin as unknown as { setRoles: (roles: Role[]) => Promise<unknown> }).setRoles([role]);
  await grantActions(role.id, [ACTIONS.USER_READ, ACTIONS.USER_UPDATE, ACTIONS.USER_SUSPEND, ACTIONS.USER_DELETE]);
  const login = await request(app).post("/v1/auth/login").send({ identifier: "distadmin", password: "ChangeMe123" });
  return { token: login.body.data.accessToken, outOfScopeUserId: soUser.id };
}

describe("users", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("forbids a Distributor from mutating an out-of-scope user (status/edit/delete)", async () => {
    const { token, outOfScopeUserId } = await seedDistributorActor();
    const bearer = { authorization: `Bearer ${token}` } as const;
    const statusRes = await request(app).patch(`/v1/users/${outOfScopeUserId}/status`).set(bearer).send({ status: "Suspended" });
    expect(statusRes.status).toBe(403);
    const editRes = await request(app).patch(`/v1/users/${outOfScopeUserId}`).set(bearer).send({ fullName: "Hacked" });
    expect(editRes.status).toBe(403);
    const delRes = await request(app).delete(`/v1/users/${outOfScopeUserId}`).set(bearer);
    expect(delRes.status).toBe(403);
  });

  it("rejects suspending a system user or a Super Administrator via status", async () => {
    const { token, tenantOrgId } = await seedAdminAndLogin();
    const sysUser = await User.create({
      orgId: tenantOrgId, tenantId: tenantOrgId, fullName: "System", username: "sysstatus", email: "sysstatus@acme.com",
      passwordHash: null, status: "Active", position: null, workUnit: null, lastLogin: null,
      activationToken: null, resetToken: null, resetExpires: null, system: true,
    });
    const sysRes = await request(app).patch(`/v1/users/${sysUser.id}/status`).set("authorization", `Bearer ${token}`).send({ status: "Suspended" });
    expect(sysRes.status).toBe(403);

    const superRole = await Role.create({ name: "Administrator", tierScope: "Tenant", orgId: tenantOrgId, isSuperAdmin: true, status: true });
    const superUser = await User.create({
      orgId: tenantOrgId, tenantId: tenantOrgId, fullName: "Owner", username: "ownerstatus", email: "ownerstatus@acme.com",
      passwordHash: null, status: "Active", position: null, workUnit: null, lastLogin: null,
      activationToken: null, resetToken: null, resetExpires: null,
    });
    await (superUser as unknown as { setRoles: (r: Role[]) => Promise<unknown> }).setRoles([superRole]);
    const superRes = await request(app).patch(`/v1/users/${superUser.id}/status`).set("authorization", `Bearer ${token}`).send({ status: "Suspended" });
    expect(superRes.status).toBe(403);
  });

  it("rejects a weak password and accepts a compliant one on create", async () => {
    const { token, tenantOrgId } = await seedAdminAndLogin();
    const weak = await request(app).post("/v1/users").set("authorization", `Bearer ${token}`)
      .send({ orgId: tenantOrgId, fullName: "Weak", username: "weakpw", email: "weak@acme.com", password: "abc" });
    expect(weak.status).toBe(400);
    expect(weak.body.error.code).toBe("WEAK_PASSWORD");

    const strong = await request(app).post("/v1/users").set("authorization", `Bearer ${token}`)
      .send({ orgId: tenantOrgId, fullName: "Strong", username: "strongpw", email: "strong@acme.com", password: "ChangeMe123" });
    expect(strong.status).toBe(201);
  });

  it("accepts the roleGroup alias on create and attaches the role", async () => {
    const { token, tenantOrgId } = await seedAdminAndLogin();
    await Role.create({ name: "Administrator", tierScope: "Tenant", orgId: tenantOrgId, isSuperAdmin: false, status: true });
    const created = await request(app).post("/v1/users").set("authorization", `Bearer ${token}`)
      .send({ orgId: tenantOrgId, fullName: "Aliased", username: "aliased", email: "aliased@acme.com", roleGroup: "Administrator" });
    expect(created.status).toBe(201);
    const filtered = await request(app).get("/v1/users?role=Administrator").set("authorization", `Bearer ${token}`);
    expect(filtered.body.data.map((u: { username: string }) => u.username)).toContain("aliased");
  });

  it("creates a user (PendingActivation) in an existing org", async () => {
    const { token, tenantOrgId } = await seedAdminAndLogin();
    const res = await request(app)
      .post("/v1/users")
      .set("authorization", `Bearer ${token}`)
      .send({ orgId: tenantOrgId, fullName: "Jane Doe", username: "jdoe", email: "jane@acme.com" });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe("Pending Activation");
    // Credential-bearing fields must never leak in the response (the
    // activationToken authorizes /v1/auth/activate).
    expect(res.body.data).not.toHaveProperty("passwordHash");
    expect(res.body.data).not.toHaveProperty("activationToken");
    expect(res.body.data).not.toHaveProperty("resetToken");
    expect(res.body.data).not.toHaveProperty("resetExpires");
  });

  it("rejects user creation for a non-existent org (FR-1)", async () => {
    const { token } = await seedAdminAndLogin();
    const res = await request(app)
      .post("/v1/users")
      .set("authorization", `Bearer ${token}`)
      .send({ orgId: "00000000-0000-0000-0000-000000000000", fullName: "X", username: "x", email: "x@x.com" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("ORG_NOT_FOUND");
  });

  it("blocks unauthenticated access", async () => {
    const res = await request(app).get("/v1/users");
    expect(res.status).toBe(401);
  });

  it("lists users filtered by status", async () => {
    const { token, tenantOrgId } = await seedAdminAndLogin();
    await request(app).post("/v1/users").set("authorization", `Bearer ${token}`)
      .send({ orgId: tenantOrgId, fullName: "A", username: "a", email: "a@acme.com" });
    const res = await request(app).get("/v1/users?status=Pending%20Activation").set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data.every((u: { status: string }) => u.status === "Pending Activation")).toBe(true);
    expect(
      res.body.data.every(
        (u: Record<string, unknown>) =>
          !("passwordHash" in u) && !("activationToken" in u) && !("resetToken" in u) && !("resetExpires" in u),
      ),
    ).toBe(true);
  });

  it("searches users by email or username (single term)", async () => {
    const { token, tenantOrgId } = await seedAdminAndLogin();
    await request(app).post("/v1/users").set("authorization", `Bearer ${token}`)
      .send({ orgId: tenantOrgId, fullName: "Alice", username: "alice", email: "alice@acme.com" });
    await request(app).post("/v1/users").set("authorization", `Bearer ${token}`)
      .send({ orgId: tenantOrgId, fullName: "Bob", username: "bob", email: "bob@acme.com" });

    // Match on username substring.
    const byName = await request(app).get("/v1/users?search=alic").set("authorization", `Bearer ${token}`);
    expect(byName.status).toBe(200);
    expect(byName.body.data.map((u: { username: string }) => u.username)).toContain("alice");
    expect(byName.body.data.map((u: { username: string }) => u.username)).not.toContain("bob");

    // Match on email substring.
    const byEmail = await request(app).get("/v1/users?search=bob@").set("authorization", `Bearer ${token}`);
    expect(byEmail.body.data.map((u: { username: string }) => u.username)).toContain("bob");
  });

  it("invites a user with a role and filters the list by that role", async () => {
    const { token, tenantOrgId } = await seedAdminAndLogin();
    // Seed a role whose name we can invite into and filter by. OD has exactly one
    // role-group enum (js/core.js:111) and no per-tier variant, so every org type
    // draws from the same four groups; "Basic User" is one of them (see
    // role.catalog) and is distinct from the "Administrator" case below.
    const memberRole = await Role.create({ name: "Basic User", tierScope: "Tenant", orgId: tenantOrgId, isSuperAdmin: false, status: true });

    const created = await request(app).post("/v1/users").set("authorization", `Bearer ${token}`)
      .send({ orgId: tenantOrgId, fullName: "Carol", username: "carol", email: "carol@acme.com", role: "Basic User" });
    expect(created.status).toBe(201);

    const filtered = await request(app).get("/v1/users?role=Basic%20User").set("authorization", `Bearer ${token}`);
    expect(filtered.status).toBe(200);
    expect(filtered.body.data.length).toBe(1);
    expect(filtered.body.data[0].username).toBe("carol");
    expect(memberRole.id).toBeTruthy();
  });

  it("rejects user creation with a role not valid for the org type (Team Member into ServiceOwner)", async () => {
    const { token } = await seedAdminAndLogin();
    // "Team Member" is not in OD's role-group enum (js/core.js:111) for any org
    // type, so the catalog check rejects it wherever it is offered.
    // The actor's own ServiceOwner org id, reused as a valid existing org.
    const me = await request(app).get("/v1/users?username=soadmin").set("authorization", `Bearer ${token}`);
    const soOrgId = me.body.data[0].orgId as string;

    const res = await request(app).post("/v1/users").set("authorization", `Bearer ${token}`)
      .send({ orgId: soOrgId, fullName: "Bad", username: "badrole", email: "bad@axia.io", role: "Team Member" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_ROLE_FOR_ORG_TYPE");
  });

  it("creates a user with a role allowed for the org type and attaches it", async () => {
    const { token, tenantOrgId } = await seedAdminAndLogin();
    await Role.create({ name: "Administrator", tierScope: "Tenant", orgId: tenantOrgId, isSuperAdmin: false, status: true });

    const created = await request(app).post("/v1/users").set("authorization", `Bearer ${token}`)
      .send({ orgId: tenantOrgId, fullName: "Tina", username: "tina", email: "tina@acme.com", role: "Administrator" });
    expect(created.status).toBe(201);

    const filtered = await request(app).get("/v1/users?role=Administrator").set("authorization", `Bearer ${token}`);
    expect(filtered.status).toBe(200);
    expect(filtered.body.data.map((u: { username: string }) => u.username)).toContain("tina");
  });

  it("rejects assigning a role whose tierScope does not match the user's org type", async () => {
    const { token, tenantOrgId } = await seedAdminAndLogin();
    const created = await request(app).post("/v1/users").set("authorization", `Bearer ${token}`)
      .send({ orgId: tenantOrgId, fullName: "Uma", username: "uma", email: "uma@acme.com" });
    const userId = created.body.data.id as string;
    // A ServiceOwner-scoped role cannot be assigned to a Tenant org user.
    const wrongRole = await Role.create({ name: "Technical Support", tierScope: "ServiceOwner", orgId: tenantOrgId, isSuperAdmin: false, status: true });

    const res = await request(app).post(`/v1/users/${userId}/roles`).set("authorization", `Bearer ${token}`)
      .send({ roleId: wrongRole.id });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_ROLE_FOR_ORG_TYPE");
  });

  it("assigns a role whose tierScope matches the user's org type", async () => {
    const { token, tenantOrgId } = await seedAdminAndLogin();
    const created = await request(app).post("/v1/users").set("authorization", `Bearer ${token}`)
      .send({ orgId: tenantOrgId, fullName: "Vera", username: "vera", email: "vera@acme.com" });
    const userId = created.body.data.id as string;
    const goodRole = await Role.create({ name: "Administrator", tierScope: "Tenant", orgId: tenantOrgId, isSuperAdmin: false, status: true });

    const res = await request(app).post(`/v1/users/${userId}/roles`).set("authorization", `Bearer ${token}`)
      .send({ roleId: goodRole.id });
    expect(res.status).toBe(201);
    expect(res.body.data.assigned).toBe(true);
  });

  it("soft-deletes a user: status becomes Deleted, excluded from default list, visible via status filter", async () => {
    const { token, tenantOrgId } = await seedAdminAndLogin();
    const created = await request(app).post("/v1/users").set("authorization", `Bearer ${token}`)
      .send({ orgId: tenantOrgId, fullName: "Dave", username: "dave", email: "dave@acme.com" });
    const id = created.body.data.id;

    const del = await request(app).delete(`/v1/users/${id}`).set("authorization", `Bearer ${token}`);
    expect(del.status).toBe(200);
    expect(del.body.data.status).toBe("Deleted");

    // Excluded from the default list…
    const after = await request(app).get("/v1/users?search=dave").set("authorization", `Bearer ${token}`);
    expect(after.body.data.map((u: { username: string }) => u.username)).not.toContain("dave");
    // …but the row is retained and reachable via the explicit status filter.
    const deleted = await request(app).get("/v1/users?status=Deleted").set("authorization", `Bearer ${token}`);
    expect(deleted.body.data.map((u: { username: string }) => u.username)).toContain("dave");
  });

  it("edits a user (fullName, status, permission metadata) via PATCH", async () => {
    const { token, tenantOrgId } = await seedAdminAndLogin();
    await Role.create({ name: "Administrator", tierScope: "Tenant", orgId: tenantOrgId, isSuperAdmin: false, status: true });
    const created = await request(app).post("/v1/users").set("authorization", `Bearer ${token}`)
      .send({ orgId: tenantOrgId, fullName: "Hank", username: "hank", email: "hank@acme.com", role: "Administrator" });
    const id = created.body.data.id as string;

    const res = await request(app).patch(`/v1/users/${id}`).set("authorization", `Bearer ${token}`)
      .send({
        fullName: "Hank Hill", status: "Active", permissionMode: "Custom Access",
        // OD `acSave` (js/core.js:5222) derives `permissions` from the menu-key
        // set, so the grant is expressed as navPerms; the caller's `permissions`
        // array is ignored on purpose.
        navPerms: ["sp-billing", "sp-tickets"], permissions: ["team", "tenant"],
      });
    expect(res.status).toBe(200);
    expect(res.body.data.fullName).toBe("Hank Hill");
    expect(res.body.data.status).toBe("Active");
    expect(res.body.data.permissionMode).toBe("Custom Access");
    expect(res.body.data.navPerms).toEqual(["sp-billing", "sp-tickets"]);
    expect(res.body.data.permissions).toEqual(["billing", "ticket"]);
    // Every granted menu carries an action list, and 'view' is always in it.
    expect(res.body.data.navActions["sp-billing"]).toContain("view");
    expect(res.body.data).not.toHaveProperty("passwordHash");
  });

  // R795 / OD js/core.js:5222 — `permissions` is computed from the role group on
  // every save, so a fixed-module group can never hold another group's modules.
  it("derives permissions from the role group and ignores the caller's array", async () => {
    const { token, tenantOrgId } = await seedAdminAndLogin();
    await Role.create({ name: "Billing Manager", tierScope: "Tenant", orgId: tenantOrgId, isSuperAdmin: false, status: true });
    const created = await request(app).post("/v1/users").set("authorization", `Bearer ${token}`)
      .send({ orgId: tenantOrgId, fullName: "Dale", username: "dale", email: "dale@acme.com" });
    const id = created.body.data.id as string;

    const res = await request(app).patch(`/v1/users/${id}`).set("authorization", `Bearer ${token}`)
      .send({ role: "Billing Manager", permissions: ["framework", "tenant"] });
    expect(res.status).toBe(200);
    expect(res.body.data.permissions).toEqual(["billing"]);
    // js/core.js:5219 — only an Administrator holds a permission mode.
    expect(res.body.data.permissionMode).toBeNull();
    // acPreset('Billing Manager') (js/core.js:4999), 'org-profile' included.
    expect(res.body.data.navPerms).toEqual(["org-profile", "sp-billing", "sp-subs"]);
    // R797 / js/core.js:5226 — granting access to an unprovisioned member resets
    // it to Pending Activation and mails a fresh activation link.
    expect(res.body.data.status).toBe("Pending Activation");
    expect((await User.findByPk(id))?.activationToken).toBeTruthy();
  });

  // R796 / OD js/core.js:5221 — an Administrator in Custom Access with no menu
  // keys aborts the whole save; the derived module list is not evidence of a grant.
  it("refuses an Administrator in Custom Access with no menu keys", async () => {
    const { token, tenantOrgId } = await seedAdminAndLogin();
    await Role.create({ name: "Administrator", tierScope: "Tenant", orgId: tenantOrgId, isSuperAdmin: false, status: true });
    const created = await request(app).post("/v1/users").set("authorization", `Bearer ${token}`)
      .send({ orgId: tenantOrgId, fullName: "Nancy", username: "nancy", email: "nancy@acme.com", role: "Administrator" });
    const id = created.body.data.id as string;

    const res = await request(app).patch(`/v1/users/${id}`).set("authorization", `Bearer ${token}`)
      .send({ permissionMode: "Custom Access", navPerms: [], permissions: ["team"] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("EMPTY_CUSTOM_ACCESS");
  });

  // Member-level access axes (SOF-84, split out of SOF-74): Enterprise
  // system-of-record access and per-business-unit grants, independent of the
  // Service Provider permissionMode/permissions grid above.
  it("edits member-level access axes (entAccess, entPerms, units, unitAccess, unitPerms) via PATCH", async () => {
    const { token, tenantOrgId } = await seedAdminAndLogin();
    const created = await request(app).post("/v1/users").set("authorization", `Bearer ${token}`)
      .send({ orgId: tenantOrgId, fullName: "Luanne", username: "luanne", email: "luanne@acme.com" });
    const id = created.body.data.id as string;

    const res = await request(app).patch(`/v1/users/${id}`).set("authorization", `Bearer ${token}`)
      .send({
        entAccess: true,
        entPerms: ["ent-doa", "ent-audits"],
        units: ["lims", "atr"],
        unitAccess: { lims: true, atr: false },
        unitPerms: { lims: ["lims-samples", "lims-tests"] },
      });
    expect(res.status).toBe(200);
    expect(res.body.data.entAccess).toBe(true);
    expect(res.body.data.entPerms).toEqual(["ent-doa", "ent-audits"]);
    expect(res.body.data.units).toEqual(["lims", "atr"]);
    // R798 / js/core.js:5240-5242 — all six AC_UNITS, explicit boolean per key.
    expect(res.body.data.unitAccess).toEqual({
      lims: true, atr: false, acert: false, abizc: false, datana: false, motoran: false,
    });
    expect(res.body.data.unitPerms.lims).toEqual(["lims-samples", "lims-tests"]);
    expect(res.body.data.unitPerms.atr).toEqual([]);
    expect(res.body.data.unitActions.lims["lims-samples"]).toContain("view");
    expect(res.body.data.entActions["ent-doa"]).toContain("view");
  });

  // R815 / OD `acSave` only ever writes catalog members (MODULES js/core.js:112,
  // acEntAllKeys :5020, AC_UNITS :5041) — an unknown key is a client bug.
  it("rejects access keys outside the OD catalogs", async () => {
    const { token, tenantOrgId } = await seedAdminAndLogin();
    const created = await request(app).post("/v1/users").set("authorization", `Bearer ${token}`)
      .send({ orgId: tenantOrgId, fullName: "Bill", username: "billd", email: "billd@acme.com" });
    const id = created.body.data.id as string;
    const patch = (body: Record<string, unknown>) =>
      request(app).patch(`/v1/users/${id}`).set("authorization", `Bearer ${token}`).send(body);

    expect((await patch({ units: ["nonexistent"] })).status).toBe(400);
    expect((await patch({ entPerms: ["not-an-ent-key"] })).status).toBe(400);
    expect((await patch({ unitAccess: { nope: true } })).status).toBe(400);
    // A unit may only hold its own item keys.
    expect((await patch({ unitPerms: { lims: ["atr-courses"] } })).status).toBe(400);
  });

  // R796 / OD acSave (js/core.js:5229-5230, 5241) writes each access flag and
  // its permission list as one pair, so revoking a domain empties its grants.
  it("clears a domain's permissions when its access is revoked", async () => {
    const { token, tenantOrgId } = await seedAdminAndLogin();
    const created = await request(app).post("/v1/users").set("authorization", `Bearer ${token}`)
      .send({ orgId: tenantOrgId, fullName: "Marge", username: "marge", email: "marge@acme.com" });
    const id = created.body.data.id as string;

    await request(app).patch(`/v1/users/${id}`).set("authorization", `Bearer ${token}`)
      .send({
        entAccess: true,
        entPerms: ["ent-doa", "ent-audits"],
        units: ["lims"],
        unitAccess: { lims: true },
        unitPerms: { lims: ["lims-samples", "lims-tests"] },
      });

    const off = await request(app).patch(`/v1/users/${id}`).set("authorization", `Bearer ${token}`)
      .send({ entAccess: false, unitAccess: { lims: false } });
    expect(off.status).toBe(200);
    expect(off.body.data.entAccess).toBe(false);
    expect(off.body.data.entPerms).toEqual([]);
    expect(off.body.data.unitPerms.lims).toEqual([]);
    expect(off.body.data.unitActions.lims).toEqual({});
  });

  it("refuses to store permissions for a domain that is not granted", async () => {
    const { token, tenantOrgId } = await seedAdminAndLogin();
    const created = await request(app).post("/v1/users").set("authorization", `Bearer ${token}`)
      .send({ orgId: tenantOrgId, fullName: "Ned", username: "ned", email: "ned@acme.com" });
    const id = created.body.data.id as string;

    const res = await request(app).patch(`/v1/users/${id}`).set("authorization", `Bearer ${token}`)
      .send({ entAccess: false, entPerms: ["ent-doa"] });
    expect(res.status).toBe(200);
    expect(res.body.data.entPerms).toEqual([]);
  });

  it("locks member-level access axes of a Super Administrator on edit", async () => {
    const { token, tenantOrgId } = await seedAdminAndLogin();
    const superRole = await Role.create({ name: "Administrator", tierScope: "Tenant", orgId: tenantOrgId, isSuperAdmin: true, status: true });
    const superUser = await User.create({
      orgId: tenantOrgId, tenantId: tenantOrgId, fullName: "Boss", username: "boss", email: "boss@acme.com",
      passwordHash: null, status: "Active", position: null, workUnit: null, lastLogin: null,
      activationToken: null, resetToken: null, resetExpires: null,
    });
    await (superUser as unknown as { setRoles: (r: Role[]) => Promise<unknown> }).setRoles([superRole]);

    const res = await request(app).patch(`/v1/users/${superUser.id}`).set("authorization", `Bearer ${token}`)
      .send({ entAccess: true });
    expect(res.status).toBe(403);
  });

  // OD tn-team member fields (migration 0047): Site / Type columns and the
  // per-member business-process assignment behind `tmBpForm` / BP Count.
  it("edits team-member fields (siteId, personnelType, processIds) via PATCH", async () => {
    const { token, tenantOrgId } = await seedAdminAndLogin();
    const site = await Site.create({
      orgId: tenantOrgId, code: "SIT-0001", name: "HQ", type: "Head Office", country: null, address: null,
      city: null, state: null, postalCode: null, status: "Active", isPrimary: true, description: null,
      contactPerson: null, contactEmail: null, contactPhone: null,
    });
    const created = await request(app).post("/v1/users").set("authorization", `Bearer ${token}`)
      .send({ orgId: tenantOrgId, fullName: "Peggy", username: "peggy", email: "peggy@acme.com" });
    const id = created.body.data.id as string;

    const res = await request(app).patch(`/v1/users/${id}`).set("authorization", `Bearer ${token}`)
      .send({ siteId: site.id, personnelType: "Employee (Permanent Contract)", processIds: ["p1", "p2"] });
    expect(res.status).toBe(200);
    expect(res.body.data.siteId).toBe(site.id);
    expect(res.body.data.personnelType).toBe("Employee (Permanent Contract)");
    expect(res.body.data.processIds).toEqual(["p1", "p2"]);

    // Clearing works, and the fields survive an unrelated PATCH untouched.
    const cleared = await request(app).patch(`/v1/users/${id}`).set("authorization", `Bearer ${token}`)
      .send({ siteId: null, processIds: [] });
    expect(cleared.body.data.siteId).toBeNull();
    expect(cleared.body.data.processIds).toEqual([]);
    expect(cleared.body.data.personnelType).toBe("Employee (Permanent Contract)");
  });

  it("rejects a siteId belonging to another organization", async () => {
    const { token, tenantOrgId } = await seedAdminAndLogin();
    const other = await Organization.create({
      name: "Other", code: "OTH", type: "Tenant", status: "Active",
      parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null,
    });
    const foreign = await Site.create({
      orgId: other.id, code: "SIT-0002", name: "Elsewhere", type: "Branch Office", country: null, address: null,
      city: null, state: null, postalCode: null, status: "Active", isPrimary: false, description: null,
      contactPerson: null, contactEmail: null, contactPhone: null,
    });

    const created = await request(app).post("/v1/users").set("authorization", `Bearer ${token}`)
      .send({ orgId: tenantOrgId, fullName: "Bobby", username: "bobby", email: "bobby@acme.com" });
    const res = await request(app).patch(`/v1/users/${created.body.data.id}`).set("authorization", `Bearer ${token}`)
      .send({ siteId: foreign.id });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("SITE_NOT_FOUND");
  });

  it("rejects a duplicate email on edit", async () => {
    const { token, tenantOrgId } = await seedAdminAndLogin();
    await request(app).post("/v1/users").set("authorization", `Bearer ${token}`)
      .send({ orgId: tenantOrgId, fullName: "Ива", username: "iva", email: "iva@acme.com" });
    const second = await request(app).post("/v1/users").set("authorization", `Bearer ${token}`)
      .send({ orgId: tenantOrgId, fullName: "Jo", username: "jo", email: "jo@acme.com" });
    const id = second.body.data.id as string;

    const res = await request(app).patch(`/v1/users/${id}`).set("authorization", `Bearer ${token}`)
      .send({ email: "iva@acme.com" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("DUPLICATE_USER");
  });

  it("locks the username of a system user on edit", async () => {
    const { token, tenantOrgId } = await seedAdminAndLogin();
    const sysUser = await User.create({
      orgId: tenantOrgId, tenantId: tenantOrgId, fullName: "System", username: "sysuser", email: "sys@acme.com",
      passwordHash: null, status: "Active", position: null, workUnit: null, lastLogin: null,
      activationToken: null, resetToken: null, resetExpires: null, system: true,
    });
    const res = await request(app).patch(`/v1/users/${sysUser.id}`).set("authorization", `Bearer ${token}`)
      .send({ username: "renamed" });
    expect(res.status).toBe(403);
  });

  it("protects a system user from soft-delete", async () => {
    const { token, tenantOrgId } = await seedAdminAndLogin();
    const sysUser = await User.create({
      orgId: tenantOrgId, tenantId: tenantOrgId, fullName: "System", username: "sysuser2", email: "sys2@acme.com",
      passwordHash: null, status: "Active", position: null, workUnit: null, lastLogin: null,
      activationToken: null, resetToken: null, resetExpires: null, system: true,
    });
    const res = await request(app).delete(`/v1/users/${sysUser.id}`).set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it("locks role/status/permissions of a Super Administrator on edit", async () => {
    const { token, tenantOrgId } = await seedAdminAndLogin();
    const superRole = await Role.create({ name: "Administrator", tierScope: "Tenant", orgId: tenantOrgId, isSuperAdmin: true, status: true });
    const superUser = await User.create({
      orgId: tenantOrgId, tenantId: tenantOrgId, fullName: "Owner", username: "owner", email: "owner@acme.com",
      passwordHash: null, status: "Active", position: null, workUnit: null, lastLogin: null,
      activationToken: null, resetToken: null, resetExpires: null,
    });
    await (superUser as unknown as { setRoles: (r: Role[]) => Promise<unknown> }).setRoles([superRole]);

    const res = await request(app).patch(`/v1/users/${superUser.id}`).set("authorization", `Bearer ${token}`)
      .send({ status: "Suspended" });
    expect(res.status).toBe(403);
  });

  it("exposes the module catalog for the permission grid", async () => {
    const { token } = await seedAdminAndLogin();
    const res = await request(app).get("/v1/modules").set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.map((m: { key: string }) => m.key)).toEqual([
      "team", "partner", "tenant", "framework", "billing", "ticket",
    ]);
  });

  it("returns 404 when removing a non-existent user", async () => {
    const { token } = await seedAdminAndLogin();
    const del = await request(app)
      .delete("/v1/users/00000000-0000-0000-0000-000000000000")
      .set("authorization", `Bearer ${token}`);
    expect(del.status).toBe(404);
  });

  it("resends the activation email for a pending user and rotates the activation token", async () => {
    const { token, tenantOrgId } = await seedAdminAndLogin();
    const created = await request(app).post("/v1/users").set("authorization", `Bearer ${token}`)
      .send({ orgId: tenantOrgId, fullName: "Erin", username: "erin", email: "erin@acme.com" });
    const id = created.body.data.id as string;
    const oldToken = (await User.findByPk(id))?.activationToken ?? null;

    const res = await request(app).post(`/v1/users/${id}/resend-activation`).set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.resent).toBe(true);
    // The token is rotated so the previous activation link is invalidated.
    const newToken = (await User.findByPk(id))?.activationToken ?? null;
    expect(newToken).toBeTruthy();
    expect(newToken).not.toBe(oldToken);
    // The token must never leak in the response envelope.
    expect(res.body.data).not.toHaveProperty("activationToken");
  });

  it("invalidates the old link and activates the account with the resent token (closes the loop)", async () => {
    const { token, tenantOrgId } = await seedAdminAndLogin();
    const created = await request(app).post("/v1/users").set("authorization", `Bearer ${token}`)
      .send({ orgId: tenantOrgId, fullName: "Finn", username: "finn", email: "finn@acme.com" });
    const id = created.body.data.id as string;
    const oldToken = (await User.findByPk(id))?.activationToken as string;

    await request(app).post(`/v1/users/${id}/resend-activation`).set("authorization", `Bearer ${token}`);
    const resentToken = (await User.findByPk(id))?.activationToken as string;

    // The previously-mailed link must no longer work after a resend.
    const staleActivate = await request(app).post("/v1/auth/activate").send({ token: oldToken, password: "ChangeMe123" });
    expect(staleActivate.status).toBe(400);
    expect(staleActivate.body.error.code).toBe("INVALID_TOKEN");

    // The freshly-mailed link activates the account and the user can sign in.
    const activated = await request(app).post("/v1/auth/activate").send({ token: resentToken, password: "ChangeMe123" });
    expect(activated.status).toBe(200);
    expect(activated.body.data.activated).toBe(true);

    const login = await request(app).post("/v1/auth/login").send({ identifier: "finn", password: "ChangeMe123" });
    expect(login.status).toBe(200);
    expect(login.body.data.accessToken).toBeTruthy();
  });

  it("rejects resending activation for a user that is not pending", async () => {
    const { token, tenantOrgId } = await seedAdminAndLogin();
    const created = await request(app).post("/v1/users").set("authorization", `Bearer ${token}`)
      .send({ orgId: tenantOrgId, fullName: "Gail", username: "gail", email: "gail@acme.com" });
    const id = created.body.data.id as string;
    const activationToken = (await User.findByPk(id))?.activationToken as string;
    await request(app).post("/v1/auth/activate").send({ token: activationToken, password: "ChangeMe123" });

    const res = await request(app).post(`/v1/users/${id}/resend-activation`).set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("NOT_PENDING_ACTIVATION");
  });

  it("returns 404 when resending activation for a non-existent user", async () => {
    const { token } = await seedAdminAndLogin();
    const res = await request(app)
      .post("/v1/users/00000000-0000-0000-0000-000000000000/resend-activation")
      .set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});
