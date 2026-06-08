import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import { initModels, Organization, Site, Subscription, User, Role } from "../../db/models";
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

const validBody = (overrides: Record<string, unknown> = {}) => ({
  organization: { name: "PT Maju Bersama", industry: "Technology", country: "ID" },
  primarySite: { name: "Jakarta HQ", type: "Head Office", country: "ID" },
  admin: { fullName: "Budi Santoso", username: "budi", email: "budi@maju.id" },
  mode: "activate",
  ...overrides,
});

describe("tenant provisioning + lifecycle", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("requires authentication", async () => {
    const res = await request(app).get("/v1/tenants");
    expect(res.status).toBe(401);
  });

  it("provisions a tenant with org + primary site + admin + subscription (activate mode)", async () => {
    const token = await soLogin();
    const res = await request(app).post("/v1/tenants").set(bearer(token)).send(validBody());
    expect(res.status).toBe(201);
    expect(res.body.data.code).toMatch(/^TEN-\d+$/);
    expect(res.body.data.status).toBe("Pending Activation");
    expect(res.body.data.primarySite).not.toBeNull();
    expect(res.body.data.primarySite.isPrimary).toBe(true);
    expect(res.body.data.admin.email).toBe("budi@maju.id");
    expect(res.body.data.acquisitionSource).toBe("Direct");

    const org = await Organization.findOne({ where: { code: res.body.data.code } });
    expect(await Site.count({ where: { orgId: org!.id, isPrimary: true } })).toBe(1);
    expect(await Subscription.count({ where: { orgId: org!.id } })).toBe(1);
    const admin = await User.findOne({ where: { orgId: org!.id } });
    expect(admin!.activationToken).not.toBeNull(); // invited
  });

  it("stages a draft tenant without inviting the admin", async () => {
    const token = await soLogin();
    const res = await request(app).post("/v1/tenants").set(bearer(token)).send(validBody({ mode: "draft" }));
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe("Draft");
    const org = await Organization.findOne({ where: { code: res.body.data.code } });
    const admin = await User.findOne({ where: { orgId: org!.id } });
    expect(admin!.activationToken).toBeNull(); // not invited
  });

  it("rolls the whole provision back if a code clashes", async () => {
    const token = await soLogin();
    await request(app).post("/v1/tenants").set(bearer(token)).send(validBody({ organization: { name: "A", code: "TEN-9000" }, admin: { fullName: "A", username: "aa", email: "a@a.io" }, primarySite: { name: "S" } }));
    const before = await Organization.count();
    const res = await request(app).post("/v1/tenants").set(bearer(token)).send(validBody({ organization: { name: "B", code: "TEN-9000" }, admin: { fullName: "B", username: "bb", email: "b@b.io" }, primarySite: { name: "S2" } }));
    expect(res.status).toBe(409);
    expect(await Organization.count()).toBe(before); // no partial tenant created
  });

  it("walks Draft → Pending Activation → Active and rejects bad transitions", async () => {
    const token = await soLogin();
    const draft = await request(app).post("/v1/tenants").set(bearer(token)).send(validBody({ mode: "draft" }));
    const id = draft.body.data.id;

    // Cannot activate a Draft directly.
    const bad = await request(app).post(`/v1/tenants/${id}/activate`).set(bearer(token));
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("INVALID_TRANSITION");

    const sent = await request(app).post(`/v1/tenants/${id}/send-activation`).set(bearer(token));
    expect(sent.status).toBe(200);
    expect(sent.body.data.status).toBe("Pending Activation");

    const active = await request(app).post(`/v1/tenants/${id}/activate`).set(bearer(token));
    expect(active.status).toBe(200);
    expect(active.body.data.status).toBe("Active");

    const suspended = await request(app).post(`/v1/tenants/${id}/suspend`).set(bearer(token));
    expect(suspended.body.data.status).toBe("Suspended");

    const resumed = await request(app).post(`/v1/tenants/${id}/resume`).set(bearer(token));
    expect(resumed.body.data.status).toBe("Active");

    const deactivated = await request(app).post(`/v1/tenants/${id}/deactivate`).set(bearer(token));
    expect(deactivated.body.data.status).toBe("Inactive");

    const reactivated = await request(app).post(`/v1/tenants/${id}/reactivate`).set(bearer(token));
    expect(reactivated.body.data.status).toBe("Active");
  });

  it("forbids a Distributor from activating a tenant (SO-only transition)", async () => {
    const soToken = await soLogin();
    const draft = await request(app).post("/v1/tenants").set(bearer(soToken)).send(validBody({ mode: "draft" }));
    const id = draft.body.data.id;
    await request(app).post(`/v1/tenants/${id}/send-activation`).set(bearer(soToken));

    // A distributor user with the grant but the wrong org type.
    const dist = await Organization.create({
      name: "NW", code: "NW", type: "Distributor", status: "Active",
      parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null,
    });
    const u = await User.create({
      orgId: dist.id, tenantId: null, fullName: "D", username: "duser", email: "d@nw.io",
      passwordHash: await hashPassword("ChangeMe123"), status: "Active",
      position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null,
    });
    const role = await Role.create({ name: "Dist Admin", tierScope: "Distributor", orgId: dist.id, isSuperAdmin: false, status: true });
    await setRoles(u, [role]);
    await grantActions(role.id, [ACTIONS.ORG_ACTIVATE]);
    const login = await request(app).post("/v1/auth/login").send({ identifier: "duser", password: "ChangeMe123" });
    const distToken = login.body.data.accessToken;

    const res = await request(app).post(`/v1/tenants/${id}/activate`).set(bearer(distToken));
    expect(res.status).toBe(403);
  });
});
