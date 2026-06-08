import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import { initModels, Organization, User, Role } from "../../db/models";
import { hashPassword } from "../../lib/password";
import { resetDb, grantActions } from "../../../test/helpers";
import { ACTIONS } from "../iam/actions.catalog";

const app = createApp();
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

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
  await (admin as unknown as { setRoles: (roles: Role[]) => Promise<unknown> }).setRoles([role]);
  const login = await request(app).post("/v1/auth/login").send({ identifier: "soadmin", password: "ChangeMe123" });
  return login.body.data.accessToken;
}

async function tenantWithGrants(): Promise<string> {
  const tenant = await Organization.create({
    name: "Acme", code: "ACME", type: "Tenant", status: "Active",
    parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null,
  });
  const user = await User.create({
    orgId: tenant.id, tenantId: tenant.id, fullName: "T", username: "tuser", email: "t@acme.io",
    passwordHash: await hashPassword("ChangeMe123"), status: "Active",
    position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null,
  });
  const role = await Role.create({ name: "Tenant Admin", tierScope: "Tenant", orgId: tenant.id, isSuperAdmin: false, status: true });
  await (user as unknown as { setRoles: (roles: Role[]) => Promise<unknown> }).setRoles([role]);
  await grantActions(role.id, [ACTIONS.AGREEMENT_READ, ACTIONS.AGREEMENT_CREATE]);
  const login = await request(app).post("/v1/auth/login").send({ identifier: "tuser", password: "ChangeMe123" });
  return login.body.data.accessToken;
}

describe("partnership agreements", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("requires authentication", async () => {
    const res = await request(app).get("/v1/partnership-agreements");
    expect(res.status).toBe(401);
  });

  it("forbids a non-Service-Owner even with grants", async () => {
    const token = await tenantWithGrants();
    const res = await request(app).post("/v1/partnership-agreements").set(bearer(token)).send({ name: "X" });
    expect(res.status).toBe(403);
  });

  it("creates a template with an auto code and default blocks", async () => {
    const token = await soLogin();
    const res = await request(app).post("/v1/partnership-agreements").set(bearer(token))
      .send({ name: "Standard Reseller Agreement", version: "v2.1" });
    expect(res.status).toBe(201);
    expect(res.body.data.code).toMatch(/^AGT-\d+$/);
    expect(res.body.data.status).toBe("Draft");
    expect(Array.isArray(res.body.data.blocks)).toBe(true);
    expect(res.body.data.blocks.length).toBeGreaterThan(0);
  });

  it("updates, duplicates, and lists templates", async () => {
    const token = await soLogin();
    const created = await request(app).post("/v1/partnership-agreements").set(bearer(token)).send({ name: "Base" });
    const upd = await request(app).put(`/v1/partnership-agreements/${created.body.data.id}`).set(bearer(token))
      .send({ status: "Active", version: "v1.1" });
    expect(upd.body.data.status).toBe("Active");

    const dup = await request(app).post(`/v1/partnership-agreements/${created.body.data.id}/duplicate`).set(bearer(token));
    expect(dup.status).toBe(201);
    expect(dup.body.data.name).toBe("Base (Copy)");
    expect(dup.body.data.status).toBe("Draft");

    const list = await request(app).get("/v1/partnership-agreements").set(bearer(token));
    expect(list.body.data).toHaveLength(2);
  });

  it("blocks deleting an Active template until archived", async () => {
    const token = await soLogin();
    const created = await request(app).post("/v1/partnership-agreements").set(bearer(token)).send({ name: "Live" });
    await request(app).put(`/v1/partnership-agreements/${created.body.data.id}`).set(bearer(token)).send({ status: "Active" });
    const del1 = await request(app).delete(`/v1/partnership-agreements/${created.body.data.id}`).set(bearer(token));
    expect(del1.status).toBe(409);
    expect(del1.body.error.code).toBe("AGREEMENT_ACTIVE");

    await request(app).put(`/v1/partnership-agreements/${created.body.data.id}`).set(bearer(token)).send({ status: "Archived" });
    const del2 = await request(app).delete(`/v1/partnership-agreements/${created.body.data.id}`).set(bearer(token));
    expect(del2.status).toBe(200);
  });

  it("validates required fields", async () => {
    const token = await soLogin();
    const res = await request(app).post("/v1/partnership-agreements").set(bearer(token)).send({ version: "v1" });
    expect(res.status).toBe(400);
  });
});
