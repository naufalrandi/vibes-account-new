import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import { initModels, Organization, User, Role } from "../../db/models";
import { hashPassword } from "../../lib/password";
import { resetDb, grantActions } from "../../../test/helpers";
import { ACTIONS } from "../iam/actions.catalog";

const app = createApp();

const SIGNATORY_ACTIONS = [
  ACTIONS.SIGNATORY_READ,
  ACTIONS.SIGNATORY_CREATE,
  ACTIONS.SIGNATORY_UPDATE,
  ACTIONS.SIGNATORY_DELETE,
];

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

const authed = (token: string) => ({ Authorization: `Bearer ${token}` });
const VALID = { fullName: "Jane Doe", title: "Director", email: "jane@acme.io" };

describe("signatories", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("requires authentication", async () => {
    const res = await request(app).get("/v1/signatories");
    expect(res.status).toBe(401);
  });

  it("forbids a role without the signatory grants", async () => {
    const { token } = await makeOrgAdmin({ orgCode: "ACME", username: "noaccess", actions: [] });
    const res = await request(app).get("/v1/signatories").set(authed(token));
    expect(res.status).toBe(403);
  });

  it("creates a signatory scoped to the caller's org and lists it", async () => {
    const { token, orgId } = await makeOrgAdmin({ orgCode: "ACME", username: "admin", actions: SIGNATORY_ACTIONS });
    const res = await request(app).post("/v1/signatories").set(authed(token)).send(VALID);
    expect(res.status).toBe(201);
    expect(res.body.data.fullName).toBe("Jane Doe");
    expect(res.body.data.orgId).toBe(orgId);
    expect(res.body.data.status).toBe("Active");

    const list = await request(app).get("/v1/signatories").set(authed(token));
    expect(list.body.data).toHaveLength(1);
    expect(list.body.meta.total).toBe(1);
  });

  it("validates required fields (400)", async () => {
    const { token } = await makeOrgAdmin({ orgCode: "ACME", username: "admin", actions: SIGNATORY_ACTIONS });
    const res = await request(app).post("/v1/signatories").set(authed(token)).send({ fullName: "No title/email" });
    expect(res.status).toBe(400);
  });

  it("rejects an invalid email (400)", async () => {
    const { token } = await makeOrgAdmin({ orgCode: "ACME", username: "admin", actions: SIGNATORY_ACTIONS });
    const res = await request(app).post("/v1/signatories").set(authed(token)).send({ ...VALID, email: "not-an-email" });
    expect(res.status).toBe(400);
  });

  it("toggles a signatory's status between Active and Inactive", async () => {
    const { token } = await makeOrgAdmin({ orgCode: "ACME", username: "admin", actions: SIGNATORY_ACTIONS });
    const created = await request(app).post("/v1/signatories").set(authed(token)).send(VALID);
    const id = created.body.data.id;
    const off = await request(app).post(`/v1/signatories/${id}/toggle`).set(authed(token));
    expect(off.body.data.status).toBe("Inactive");
    const on = await request(app).post(`/v1/signatories/${id}/toggle`).set(authed(token));
    expect(on.body.data.status).toBe("Active");
  });

  it("updates and deletes a signatory in the caller's org", async () => {
    const { token } = await makeOrgAdmin({ orgCode: "ACME", username: "admin", actions: SIGNATORY_ACTIONS });
    const created = await request(app).post("/v1/signatories").set(authed(token)).send(VALID);
    const id = created.body.data.id;
    const upd = await request(app).put(`/v1/signatories/${id}`).set(authed(token)).send({ title: "VP" });
    expect(upd.body.data.title).toBe("VP");
    const del = await request(app).delete(`/v1/signatories/${id}`).set(authed(token));
    expect(del.status).toBe(200);
    const list = await request(app).get("/v1/signatories").set(authed(token));
    expect(list.body.data).toHaveLength(0);
  });

  it("isolates signatories across organizations", async () => {
    const a = await makeOrgAdmin({ orgCode: "ORGA", username: "a-admin", actions: SIGNATORY_ACTIONS });
    const b = await makeOrgAdmin({ orgCode: "ORGB", username: "b-admin", actions: SIGNATORY_ACTIONS });
    const created = await request(app).post("/v1/signatories").set(authed(a.token)).send(VALID);
    const id = created.body.data.id;

    // Org B cannot see Org A's signatory…
    const bList = await request(app).get("/v1/signatories").set(authed(b.token));
    expect(bList.body.data).toHaveLength(0);
    // …nor mutate it.
    const bUpdate = await request(app).put(`/v1/signatories/${id}`).set(authed(b.token)).send({ title: "Hacked" });
    expect(bUpdate.status).toBe(404);
  });
});
