import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import { initModels, Organization, User, Role } from "../../db/models";
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
    orgId: so.id, tenantId: null, fullName: "SO", username: "soadmin", email: "soadmin@axia.io",
    passwordHash: await hashPassword("ChangeMe123"), status: "Active",
    position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null,
  });
  const role = await Role.create({ name: "SO Administrator", tierScope: "ServiceOwner", orgId: so.id, isSuperAdmin: true, status: true });
  await setRoles(admin, [role]);
  const login = await request(app).post("/v1/auth/login").send({ identifier: "soadmin", password: "ChangeMe123" });
  return login.body.data.accessToken;
}

async function tenantLogin(): Promise<string> {
  const t = await Organization.create({
    name: "Acme", code: "ACME", type: "Tenant", status: "Active",
    parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null,
  });
  await t.update({ tenantId: t.id });
  const u = await User.create({
    orgId: t.id, tenantId: t.id, fullName: "T", username: "tadmin", email: "t@acme.io",
    passwordHash: await hashPassword("ChangeMe123"), status: "Active",
    position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null,
  });
  const role = await Role.create({ name: "Tenant Admin", tierScope: "Tenant", orgId: t.id, isSuperAdmin: false, status: true });
  await setRoles(u, [role]);
  // Even with any granted action, a tenant is not the Service Owner.
  await grantActions(role.id, [ACTIONS.ORG_READ]);
  const login = await request(app).post("/v1/auth/login").send({ identifier: "tadmin", password: "ChangeMe123" });
  return login.body.data.accessToken;
}

describe("business unit registers", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("requires authentication", async () => {
    const res = await request(app).get("/v1/business/datana/dn-pentest");
    expect(res.status).toBe(401);
  });

  it("rejects an unknown area", async () => {
    const token = await soLogin();
    const res = await request(app).get("/v1/business/bogus/x-y").set(bearer(token));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_AREA");
  });

  it("creates a record with a derived PREFIX-#### code", async () => {
    const token = await soLogin();
    const res = await request(app).post("/v1/business/datana/dn-pentest").set(bearer(token))
      .send({ title: "Acme Web App Pentest", status: "In Progress", data: { client: "Acme", scope: "Web" } });
    expect(res.status).toBe(201);
    expect(res.body.data.code).toBe("PEN-0001");
    expect(res.body.data.area).toBe("datana");
    expect(res.body.data.module).toBe("dn-pentest");
    expect(res.body.data.data.client).toBe("Acme");
  });

  it("forbids a non-Service-Owner", async () => {
    const token = await tenantLogin();
    const res = await request(app).get("/v1/business/motoran/mb-fleet").set(bearer(token));
    expect(res.status).toBe(403);
  });

  it("updates and deletes a record, scoped per area/module", async () => {
    const token = await soLogin();
    const created = await request(app).post("/v1/business/motoran/mb-fleet").set(bearer(token)).send({ title: "Vario 160", data: { plate: "DK 1" } });
    const id = created.body.data.id;
    const upd = await request(app).put(`/v1/business/motoran/mb-fleet/${id}`).set(bearer(token)).send({ status: "Rented" });
    expect(upd.body.data.status).toBe("Rented");
    // Wrong module path must not resolve the record.
    const wrong = await request(app).get(`/v1/business/motoran/mb-booking/${id}`).set(bearer(token));
    expect(wrong.status).toBe(404);
    const del = await request(app).delete(`/v1/business/motoran/mb-fleet/${id}`).set(bearer(token));
    expect(del.status).toBe(200);
    const list = await request(app).get("/v1/business/motoran/mb-fleet").set(bearer(token));
    expect(list.body.data).toHaveLength(0);
  });
});
