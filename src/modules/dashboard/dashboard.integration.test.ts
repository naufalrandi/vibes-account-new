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

async function seedTenantMember() {
  const org = await Organization.create({
    name: "Acme Corp", code: "ACME", type: "Tenant", status: "Active",
    parentOrgId: null, tenantId: null, email: null, phone: null,
    website: null, country: "US", address: null,
  });
  // Deliberately no roles granted — this is the persona that used to be sent
  // to the FE's `/member/dashboard` (removed in SOF-91).
  await User.create({
    orgId: org.id, tenantId: null, fullName: "Tenant Member", username: "tmember",
    email: "member@acme.io", passwordHash: await hashPassword("ChangeMe123"),
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

  it("GET /v1/dashboard/stats reports zero admins when no admin roles are assigned (empty data)", async () => {
    await seedServiceOwner();
    const token = await login("soadmin", "ChangeMe123");
    const res = await request(app)
      .get("/v1/dashboard/stats")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    // Exactly one org / one user seeded, and that user has no super-admin role.
    expect(res.body.data.totalOrgs).toBe(1);
    expect(res.body.data.activeOrgs).toBe(1);
    expect(res.body.data.totalUsers).toBe(1);
    expect(res.body.data.activeUsers).toBe(1);
    expect(res.body.data.adminUsers).toBe(0);
  });

  it("GET /v1/dashboard/stats reports zero active subscriptions for an org with no subscriptions (empty data)", async () => {
    await seedDistributor();
    const token = await login("distadmin", "ChangeMe123");
    const res = await request(app)
      .get("/v1/dashboard/stats")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.role).toBe("Administrator");
    expect(res.body.data.activeSubscriptions).toBe(0);
    expect(res.body.data.totalUsers).toBe(1);
    expect(res.body.data.activeUsers).toBe(1);
  });

  // SOF-91: every tenant persona now lands on the FE's `/administrator/dashboard`,
  // which renders OD's tn-dashboard. A tenant user with no administrator role must
  // therefore get the tn-dashboard payload, not a Member shape that page cannot render.
  it("GET /v1/dashboard/stats returns the tn-dashboard shape for a tenant user with no roles", async () => {
    await seedTenantMember();
    const token = await login("tmember", "ChangeMe123");
    const res = await request(app)
      .get("/v1/dashboard/stats")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.role).toBe("Administrator");
    expect(res.body.data.orgType).toBe("Tenant");
    expect(Array.isArray(res.body.data.siteList)).toBe(true);
    expect(Array.isArray(res.body.data.assignments)).toBe(true);
    expect(res.body.data.tenant.name).toBe("Acme Corp");
  });


  // The AXIA Clients · SaaS preview: a Service Owner asks for a tenant's
  // dashboard without becoming that tenant. Authorization must still come from
  // `visibleTenantOrgIds`, so this also pins the negative case.
  it("GET /v1/dashboard/stats?orgId= returns that tenant's shape for a Service Owner", async () => {
    const org = await seedServiceOwner();
    const tenantOrg = await Organization.create({
      code: "ORG-TEN-1", name: "Garuda", type: "Tenant", parentOrgId: org.id, tenantId: null,
      email: null, phone: null, website: null, country: "ID", address: null, status: "Active",
    });
    const token = await login("soadmin", "ChangeMe123");

    const res = await request(app)
      .get(`/v1/dashboard/stats?orgId=${tenantOrg.id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.orgType).toBe("Tenant");
    expect(res.body.data).toHaveProperty("siteList");
  });

  it("GET /v1/dashboard/stats?orgId= refuses an org the caller cannot see", async () => {
    // A tenant user (`tmember`, seeded by `seedTenantMember`) asking for a different
    // tenant's dashboard — the case the scope check has to refuse.
    await seedTenantMember();
    const foreign = await Organization.create({
      code: "ORG-FOREIGN", name: "Foreign", type: "Tenant", parentOrgId: null, tenantId: null,
      email: null, phone: null, website: null, country: null, address: null, status: "Active",
    });
    const token = await login("tmember", "ChangeMe123");

    const res = await request(app)
      .get(`/v1/dashboard/stats?orgId=${foreign.id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(403);
  });
});
