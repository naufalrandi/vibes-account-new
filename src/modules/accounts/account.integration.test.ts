import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import { initModels, Organization, User, Role, Account } from "../../db/models";
import { hashPassword } from "../../lib/password";
import { resetDb, grantActions } from "../../../test/helpers";
import { ACTIONS } from "../iam/actions.catalog";

const app = createApp();

const ACCOUNT_ACTIONS = [
  ACTIONS.ACCOUNT_READ,
  ACTIONS.ACCOUNT_CREATE,
  ACTIONS.ACCOUNT_UPDATE,
  ACTIONS.ACCOUNT_DELETE,
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

function authed(token: string) {
  return { Authorization: `Bearer ${token}` };
}

const SAMPLE = {
  name: "Prod AWS",
  description: "Production cloud account",
  provider: "AWS",
  externalId: "acct-123456",
  role: "Owner",
  status: "Active" as const,
};

describe("accounts", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("requires authentication", async () => {
    const res = await request(app).get("/v1/accounts");
    expect(res.status).toBe(401);
  });

  it("forbids a role without the account action grants", async () => {
    const { token } = await makeOrgAdmin({ orgCode: "ACME", username: "noaccess", actions: [] });
    const res = await request(app).get("/v1/accounts").set(authed(token));
    expect(res.status).toBe(403);
  });

  it("lists an empty set with a zero total", async () => {
    const { token } = await makeOrgAdmin({ orgCode: "ACME", username: "admin", actions: ACCOUNT_ACTIONS });
    const res = await request(app).get("/v1/accounts").set(authed(token));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.meta.total).toBe(0);
  });

  it("creates an account scoped to the caller's org and lists it", async () => {
    const { token, orgId } = await makeOrgAdmin({ orgCode: "ACME", username: "admin", actions: ACCOUNT_ACTIONS });
    const res = await request(app).post("/v1/accounts").set(authed(token)).send(SAMPLE);
    expect(res.status).toBe(201);
    expect(res.body.data.provider).toBe("AWS");
    expect(res.body.data.externalId).toBe("acct-123456");
    expect(res.body.data.orgId).toBe(orgId);

    const list = await request(app).get("/v1/accounts").set(authed(token));
    expect(list.body.data).toHaveLength(1);
    expect(list.body.meta.total).toBe(1);
  });

  it("ignores a client-supplied orgId and uses the authenticated org", async () => {
    const { token, orgId } = await makeOrgAdmin({ orgCode: "ACME", username: "admin", actions: ACCOUNT_ACTIONS });
    const res = await request(app).post("/v1/accounts").set(authed(token))
      .send({ ...SAMPLE, orgId: "00000000-0000-0000-0000-000000000000" });
    expect(res.status).toBe(201);
    expect(res.body.data.orgId).toBe(orgId);
  });

  it("validates required fields", async () => {
    const { token } = await makeOrgAdmin({ orgCode: "ACME", username: "admin", actions: ACCOUNT_ACTIONS });
    const res = await request(app).post("/v1/accounts").set(authed(token)).send({ provider: "AWS" });
    expect(res.status).toBe(400);
  });

  it("filters the list by search, status, and role", async () => {
    const { token } = await makeOrgAdmin({ orgCode: "ACME", username: "admin", actions: ACCOUNT_ACTIONS });
    await request(app).post("/v1/accounts").set(authed(token))
      .send({ name: "Prod AWS", provider: "AWS", externalId: "acct-999", role: "Owner", status: "Active" });
    await request(app).post("/v1/accounts").set(authed(token))
      .send({ name: "Staging GCP", provider: "GCP", externalId: "proj-staging", role: "Viewer", status: "Inactive" });

    const bySearchProvider = await request(app).get("/v1/accounts?search=gcp").set(authed(token));
    expect(bySearchProvider.body.data).toHaveLength(1);
    expect(bySearchProvider.body.data[0].name).toBe("Staging GCP");

    const bySearchExternal = await request(app).get("/v1/accounts?search=acct-999").set(authed(token));
    expect(bySearchExternal.body.data).toHaveLength(1);
    expect(bySearchExternal.body.data[0].name).toBe("Prod AWS");

    const byStatus = await request(app).get("/v1/accounts?status=Inactive").set(authed(token));
    expect(byStatus.body.data).toHaveLength(1);
    expect(byStatus.body.data[0].name).toBe("Staging GCP");

    const byRole = await request(app).get("/v1/accounts?role=Owner").set(authed(token));
    expect(byRole.body.data).toHaveLength(1);
    expect(byRole.body.data[0].name).toBe("Prod AWS");
  });

  it("updates an account in the caller's org", async () => {
    const { token } = await makeOrgAdmin({ orgCode: "ACME", username: "admin", actions: ACCOUNT_ACTIONS });
    const created = await request(app).post("/v1/accounts").set(authed(token)).send(SAMPLE);
    const res = await request(app).put(`/v1/accounts/${created.body.data.id}`).set(authed(token))
      .send({ name: "Prod AWS (renamed)", status: "Inactive", role: "Viewer" });
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe("Prod AWS (renamed)");
    expect(res.body.data.status).toBe("Inactive");
    expect(res.body.data.role).toBe("Viewer");
  });

  it("deletes an account in the caller's org", async () => {
    const { token } = await makeOrgAdmin({ orgCode: "ACME", username: "admin", actions: ACCOUNT_ACTIONS });
    const created = await request(app).post("/v1/accounts").set(authed(token)).send(SAMPLE);
    const res = await request(app).delete(`/v1/accounts/${created.body.data.id}`).set(authed(token));
    expect(res.status).toBe(200);
    const list = await request(app).get("/v1/accounts").set(authed(token));
    expect(list.body.data).toHaveLength(0);
  });

  it("returns ACCOUNT_NOT_FOUND for an unknown id", async () => {
    const { token } = await makeOrgAdmin({ orgCode: "ACME", username: "admin", actions: ACCOUNT_ACTIONS });
    const res = await request(app).put("/v1/accounts/00000000-0000-0000-0000-000000000000")
      .set(authed(token)).send({ name: "X" });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("ACCOUNT_NOT_FOUND");
  });

  it("cannot read, update, or delete an account from another org", async () => {
    const a = await makeOrgAdmin({ orgCode: "ORGA", username: "alice", actions: ACCOUNT_ACTIONS });
    const b = await makeOrgAdmin({ orgCode: "ORGB", username: "bob", actions: ACCOUNT_ACTIONS });

    const aAccount = await request(app).post("/v1/accounts").set(authed(a.token)).send({ ...SAMPLE, name: "A-Secret" });
    const id = aAccount.body.data.id;

    const bList = await request(app).get("/v1/accounts").set(authed(b.token));
    expect(bList.body.data).toHaveLength(0);

    const upd = await request(app).put(`/v1/accounts/${id}`).set(authed(b.token)).send({ name: "Hijack" });
    expect(upd.status).toBe(404);
    const del = await request(app).delete(`/v1/accounts/${id}`).set(authed(b.token));
    expect(del.status).toBe(404);

    expect(await Account.count()).toBe(1);
  });
});
