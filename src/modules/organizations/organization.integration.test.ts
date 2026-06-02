import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import { initModels, Organization, User, Role } from "../../db/models";
import { hashPassword } from "../../lib/password";
import { resetDb } from "../../../test/helpers";

const app = createApp();

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
  // belongsToMany generates a `setRoles` mixin at runtime; `.set("Roles", ...)` is the
  // generic attribute setter and does NOT persist the association (matches user tests).
  await (admin as unknown as { setRoles: (roles: Role[]) => Promise<unknown> }).setRoles([role]);
  const login = await request(app).post("/v1/auth/login").send({ identifier: "soadmin", password: "ChangeMe123" });
  return login.body.data.accessToken;
}

describe("organizations", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("SO creates a tenant org (Active, tenantId=self)", async () => {
    const token = await soLogin();
    const res = await request(app).post("/v1/organizations").set("authorization", `Bearer ${token}`)
      .send({ name: "Acme", code: "ACME", type: "Tenant", country: "US" });
    expect(res.status).toBe(201);
    expect(res.body.data.type).toBe("Tenant");
    expect(res.body.data.tenantId).toBe(res.body.data.id);
  });

  it("returns ORG_NOT_FOUND for a missing org", async () => {
    const token = await soLogin();
    const res = await request(app).get("/v1/organizations/00000000-0000-0000-0000-000000000000")
      .set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("ORG_NOT_FOUND");
  });

  it("suspends an org", async () => {
    const token = await soLogin();
    const created = await request(app).post("/v1/organizations").set("authorization", `Bearer ${token}`)
      .send({ name: "Globex", code: "GLBX", type: "Tenant" });
    const res = await request(app).post(`/v1/organizations/${created.body.data.id}/suspend`)
      .set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("Suspended");
  });
});
