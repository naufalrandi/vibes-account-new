import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import { initModels, Organization, User, Role } from "../../db/models";
import { hashPassword } from "../../lib/password";
import { resetDb, grantActions } from "../../../test/helpers";
import { ACTIONS } from "../iam/actions.catalog";

const app = createApp();
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

interface SeedOpts {
  superAdmin?: boolean;
  actions?: string[];
}

async function seedLogin(opts: SeedOpts = {}): Promise<{ token: string; org: Organization }> {
  const org = await Organization.create({
    name: "AXIA", code: "AXIA", type: "ServiceOwner", status: "Active",
    parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null,
  });
  const user = await User.create({
    orgId: org.id, tenantId: null, fullName: "Admin", username: "soadmin", email: "soadmin@axia.io",
    passwordHash: await hashPassword("ChangeMe123"), status: "Active",
    position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null,
  });
  const role = await Role.create({
    name: opts.superAdmin ? "SO Administrator" : "Limited",
    tierScope: "ServiceOwner", orgId: org.id, isSuperAdmin: opts.superAdmin ?? false, status: true,
  });
  await (user as unknown as { setRoles: (roles: Role[]) => Promise<unknown> }).setRoles([role]);
  if (!opts.superAdmin && opts.actions?.length) await grantActions(role.id, opts.actions);
  const login = await request(app).post("/v1/auth/login").send({ identifier: "soadmin", password: "ChangeMe123" });
  return { token: login.body.data.accessToken, org };
}

async function create(token: string, body: Record<string, unknown>) {
  return request(app).post("/v1/signatories").set(bearer(token)).send(body);
}

describe("signatories", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("requires authentication", async () => {
    expect((await request(app).get("/v1/signatories")).status).toBe(401);
  });

  it("creates, lists, updates and toggles a signatory", async () => {
    const { token } = await seedLogin({ superAdmin: true });
    const created = await create(token, { fullName: "AXIA Platform Owner", title: "CEO", email: "ceo@axia.io" });
    expect(created.status).toBe(201);
    expect(created.body.data.status).toBe("Active");
    const id = created.body.data.id;

    const list = await request(app).get("/v1/signatories").set(bearer(token));
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].fullName).toBe("AXIA Platform Owner");

    const updated = await request(app).put(`/v1/signatories/${id}`).set(bearer(token)).send({ title: "Chief Executive Officer" });
    expect(updated.status).toBe(200);
    expect(updated.body.data.title).toBe("Chief Executive Officer");

    const toggled = await request(app).post(`/v1/signatories/${id}/toggle`).set(bearer(token));
    expect(toggled.status).toBe(200);
    expect(toggled.body.data.status).toBe("Inactive");

    const toggledBack = await request(app).post(`/v1/signatories/${id}/toggle`).set(bearer(token));
    expect(toggledBack.body.data.status).toBe("Active");
  });

  it("rejects an invalid email on create", async () => {
    const { token } = await seedLogin({ superAdmin: true });
    const res = await create(token, { fullName: "X", title: "Y", email: "not-an-email" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("scopes signatories to the caller's org", async () => {
    const a = await seedLogin({ superAdmin: true });
    await create(a.token, { fullName: "A Sig", title: "T", email: "a@axia.io" });

    // A second SO org + user cannot see org A's signatory.
    const otherOrg = await Organization.create({
      name: "Globex", code: "GLBX", type: "ServiceOwner", status: "Active",
      parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null,
    });
    const otherUser = await User.create({
      orgId: otherOrg.id, tenantId: null, fullName: "Other", username: "otheradmin", email: "other@glbx.io",
      passwordHash: await hashPassword("ChangeMe123"), status: "Active",
      position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null,
    });
    const otherRole = await Role.create({ name: "SO Administrator", tierScope: "ServiceOwner", orgId: otherOrg.id, isSuperAdmin: true, status: true });
    await (otherUser as unknown as { setRoles: (roles: Role[]) => Promise<unknown> }).setRoles([otherRole]);
    const otherLogin = await request(app).post("/v1/auth/login").send({ identifier: "otheradmin", password: "ChangeMe123" });
    const list = await request(app).get("/v1/signatories").set(bearer(otherLogin.body.data.accessToken));
    expect(list.body.data).toHaveLength(0);
  });

  it("forbids a role without the signatory.create grant", async () => {
    const { token } = await seedLogin({ actions: [ACTIONS.SIGNATORY_READ] });
    const ok = await request(app).get("/v1/signatories").set(bearer(token));
    expect(ok.status).toBe(200);
    const res = await create(token, { fullName: "X", title: "Y", email: "x@axia.io" });
    expect(res.status).toBe(403);
  });
});
