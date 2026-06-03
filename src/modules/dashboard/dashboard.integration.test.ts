import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import { initModels, Organization, User } from "../../db/models";
import { hashPassword } from "../../lib/password";
import { resetDb } from "../../../test/helpers";

const app = createApp();

async function seedServiceOwner() {
  const org = await Organization.create({
    name: "AXIA", code: "AXIA", type: "ServiceOwner", status: "Active",
    parentOrgId: null, tenantId: null, email: null, phone: null,
    website: null, country: null, address: null,
  });
  await User.create({
    orgId: org.id, tenantId: null, fullName: "SO Admin", username: "soadmin",
    email: "soadmin@axia.io", passwordHash: await hashPassword("ChangeMe123"),
    status: "Active", position: null, workUnit: null, lastLogin: null,
    activationToken: null, resetToken: null, resetExpires: null,
  });
  return org;
}

async function seedDistributor() {
  const org = await Organization.create({
    name: "Northwind", code: "NWP", type: "Distributor", status: "Active",
    parentOrgId: null, tenantId: null, email: null, phone: null,
    website: null, country: null, address: null,
  });
  await User.create({
    orgId: org.id, tenantId: null, fullName: "Dist Admin", username: "distadmin",
    email: "distadmin@northwind.io", passwordHash: await hashPassword("ChangeMe123"),
    status: "Active", position: null, workUnit: null, lastLogin: null,
    activationToken: null, resetToken: null, resetExpires: null,
  });
  return org;
}

async function login(identifier: string, password: string): Promise<string> {
  const res = await request(app)
    .post("/v1/auth/login")
    .send({ identifier, password });
  return res.body.data.accessToken as string;
}

describe("dashboard", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("GET /v1/dashboard/stats returns ServiceOwner shape for ServiceOwner user", async () => {
    await seedServiceOwner();
    const token = await login("soadmin", "ChangeMe123");
    const res = await request(app)
      .get("/v1/dashboard/stats")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.role).toBe("ServiceOwner");
    expect(typeof res.body.data.totalOrgs).toBe("number");
    expect(typeof res.body.data.activeOrgs).toBe("number");
    expect(typeof res.body.data.totalUsers).toBe("number");
    expect(typeof res.body.data.activeUsers).toBe("number");
    expect(typeof res.body.data.adminUsers).toBe("number");
  });

  it("GET /v1/dashboard/stats returns 401 without a token", async () => {
    const res = await request(app).get("/v1/dashboard/stats");
    expect(res.status).toBe(401);
  });

  it("GET /v1/dashboard/recent returns orgs and users arrays", async () => {
    await seedServiceOwner();
    const token = await login("soadmin", "ChangeMe123");
    const res = await request(app)
      .get("/v1/dashboard/recent")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.orgs)).toBe(true);
    expect(Array.isArray(res.body.data.users)).toBe(true);
  });

  it("GET /v1/dashboard/stats returns Administrator shape for Distributor user", async () => {
    await seedDistributor();
    const token = await login("distadmin", "ChangeMe123");
    const res = await request(app)
      .get("/v1/dashboard/stats")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.role).toBe("Administrator");
    expect(typeof res.body.data.activeSubscriptions).toBe("number");
    expect(res.body.data.totalFrameworks).toBe(13);
    expect(typeof res.body.data.totalUsers).toBe("number");
  });

  it("GET /v1/dashboard/recent returns shaped orgs and users", async () => {
    await seedServiceOwner();
    const token = await login("soadmin", "ChangeMe123");
    const res = await request(app)
      .get("/v1/dashboard/recent")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.orgs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: expect.any(String), name: expect.any(String), code: expect.any(String), status: expect.any(String) }),
      ]),
    );
    expect(res.body.data.users).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: expect.any(String), fullName: expect.any(String), email: expect.any(String), status: expect.any(String), role: expect.any(String) }),
      ]),
    );
  });

  it("GET /v1/dashboard/recent returns arrays for Distributor user", async () => {
    await seedDistributor();
    const token = await login("distadmin", "ChangeMe123");
    const res = await request(app)
      .get("/v1/dashboard/recent")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.orgs)).toBe(true);
    expect(Array.isArray(res.body.data.users)).toBe(true);
  });
});
