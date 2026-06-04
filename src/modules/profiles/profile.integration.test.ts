import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import { initModels, Organization, User, Role, Profile } from "../../db/models";
import { hashPassword } from "../../lib/password";
import { resetDb, grantActions } from "../../../test/helpers";
import { ACTIONS } from "../iam/actions.catalog";

const app = createApp();

const PROFILE_ACTIONS = [
  ACTIONS.PROFILE_READ,
  ACTIONS.PROFILE_CREATE,
  ACTIONS.PROFILE_UPDATE,
  ACTIONS.PROFILE_DELETE,
];

/** Create an organization with an admin user that holds the given action grants. */
async function makeOrgAdmin(opts: {
  orgCode: string;
  username: string;
  actions?: string[];
}): Promise<{ token: string; orgId: string }> {
  const org = await Organization.create({
    name: opts.orgCode, code: opts.orgCode, type: "Tenant", status: "Active",
    parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null,
  });
  const user = await User.create({
    orgId: org.id, tenantId: org.id, fullName: "Admin", username: opts.username, email: `${opts.username}@acme.io`,
    passwordHash: await hashPassword("ChangeMe123"), status: "Active",
    position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null,
  });
  const role = await Role.create({ name: "Org Admin", tierScope: "Tenant", orgId: org.id, isSuperAdmin: false, status: true });
  await (user as unknown as { setRoles: (roles: Role[]) => Promise<unknown> }).setRoles([role]);
  if (opts.actions?.length) await grantActions(role.id, opts.actions);
  const login = await request(app).post("/v1/auth/login").send({ identifier: opts.username, password: "ChangeMe123" });
  return { token: login.body.data.accessToken, orgId: org.id };
}

function authed(token: string) {
  return { Authorization: `Bearer ${token}` };
}

describe("profiles", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("requires authentication", async () => {
    const res = await request(app).get("/v1/profiles");
    expect(res.status).toBe(401);
  });

  it("forbids a role without the profile action grants", async () => {
    const { token } = await makeOrgAdmin({ orgCode: "ACME", username: "noaccess", actions: [] });
    const res = await request(app).get("/v1/profiles").set(authed(token));
    expect(res.status).toBe(403);
  });

  it("lists an empty set with a zero total", async () => {
    const { token } = await makeOrgAdmin({ orgCode: "ACME", username: "admin", actions: PROFILE_ACTIONS });
    const res = await request(app).get("/v1/profiles").set(authed(token));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.meta.total).toBe(0);
  });

  it("creates a profile scoped to the caller's org and lists it", async () => {
    const { token, orgId } = await makeOrgAdmin({ orgCode: "ACME", username: "admin", actions: PROFILE_ACTIONS });
    const res = await request(app).post("/v1/profiles").set(authed(token))
      .send({ name: "Read Only", description: "View-only access", status: "Active" });
    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe("Read Only");
    expect(res.body.data.orgId).toBe(orgId);

    const list = await request(app).get("/v1/profiles").set(authed(token));
    expect(list.body.data).toHaveLength(1);
    expect(list.body.meta.total).toBe(1);
  });

  it("ignores a client-supplied orgId and uses the authenticated org", async () => {
    const { token, orgId } = await makeOrgAdmin({ orgCode: "ACME", username: "admin", actions: PROFILE_ACTIONS });
    const res = await request(app).post("/v1/profiles").set(authed(token))
      .send({ name: "Spoofed", orgId: "00000000-0000-0000-0000-000000000000" });
    expect(res.status).toBe(201);
    expect(res.body.data.orgId).toBe(orgId);
  });

  it("validates required fields", async () => {
    const { token } = await makeOrgAdmin({ orgCode: "ACME", username: "admin", actions: PROFILE_ACTIONS });
    const res = await request(app).post("/v1/profiles").set(authed(token)).send({ description: "no name" });
    expect(res.status).toBe(400);
  });

  it("filters the list by search term and status", async () => {
    const { token } = await makeOrgAdmin({ orgCode: "ACME", username: "admin", actions: PROFILE_ACTIONS });
    await request(app).post("/v1/profiles").set(authed(token)).send({ name: "Administrator", status: "Active" });
    await request(app).post("/v1/profiles").set(authed(token)).send({ name: "Auditor", status: "Inactive" });

    const search = await request(app).get("/v1/profiles?search=admin").set(authed(token));
    expect(search.body.data).toHaveLength(1);
    expect(search.body.data[0].name).toBe("Administrator");

    const byStatus = await request(app).get("/v1/profiles?status=Inactive").set(authed(token));
    expect(byStatus.body.data).toHaveLength(1);
    expect(byStatus.body.data[0].name).toBe("Auditor");
  });

  it("updates a profile in the caller's org", async () => {
    const { token } = await makeOrgAdmin({ orgCode: "ACME", username: "admin", actions: PROFILE_ACTIONS });
    const created = await request(app).post("/v1/profiles").set(authed(token)).send({ name: "Temp" });
    const res = await request(app).put(`/v1/profiles/${created.body.data.id}`).set(authed(token))
      .send({ name: "Renamed", status: "Inactive" });
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe("Renamed");
    expect(res.body.data.status).toBe("Inactive");
  });

  it("deletes a profile in the caller's org", async () => {
    const { token } = await makeOrgAdmin({ orgCode: "ACME", username: "admin", actions: PROFILE_ACTIONS });
    const created = await request(app).post("/v1/profiles").set(authed(token)).send({ name: "Disposable" });
    const res = await request(app).delete(`/v1/profiles/${created.body.data.id}`).set(authed(token));
    expect(res.status).toBe(200);
    const list = await request(app).get("/v1/profiles").set(authed(token));
    expect(list.body.data).toHaveLength(0);
  });

  it("returns PROFILE_NOT_FOUND for an unknown id", async () => {
    const { token } = await makeOrgAdmin({ orgCode: "ACME", username: "admin", actions: PROFILE_ACTIONS });
    const res = await request(app).put("/v1/profiles/00000000-0000-0000-0000-000000000000")
      .set(authed(token)).send({ name: "X" });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("PROFILE_NOT_FOUND");
  });

  it("cannot read, update, or delete a profile from another org", async () => {
    const a = await makeOrgAdmin({ orgCode: "ORGA", username: "alice", actions: PROFILE_ACTIONS });
    const b = await makeOrgAdmin({ orgCode: "ORGB", username: "bob", actions: PROFILE_ACTIONS });

    const aProfile = await request(app).post("/v1/profiles").set(authed(a.token)).send({ name: "A-Secret" });
    const id = aProfile.body.data.id;

    // B's list must not include A's profile.
    const bList = await request(app).get("/v1/profiles").set(authed(b.token));
    expect(bList.body.data).toHaveLength(0);

    // B cannot update or delete A's profile — both surface as not-found.
    const upd = await request(app).put(`/v1/profiles/${id}`).set(authed(b.token)).send({ name: "Hijack" });
    expect(upd.status).toBe(404);
    const del = await request(app).delete(`/v1/profiles/${id}`).set(authed(b.token));
    expect(del.status).toBe(404);

    // A's profile is untouched.
    expect(await Profile.count()).toBe(1);
  });
});
