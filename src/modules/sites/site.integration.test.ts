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

/** A Tenant-scoped user that holds the site grants but the wrong org type. */
async function tenantWithGrants(): Promise<string> {
  const tenant = await Organization.create({
    name: "Acme", code: "ACME-U", type: "Tenant", status: "Active",
    parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null,
  });
  const user = await User.create({
    orgId: tenant.id, tenantId: tenant.id, fullName: "T", username: "tuser", email: "t@acme.io",
    passwordHash: await hashPassword("ChangeMe123"), status: "Active",
    position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null,
  });
  const role = await Role.create({ name: "Tenant Admin", tierScope: "Tenant", orgId: tenant.id, isSuperAdmin: false, status: true });
  await (user as unknown as { setRoles: (roles: Role[]) => Promise<unknown> }).setRoles([role]);
  await grantActions(role.id, [ACTIONS.SITE_READ, ACTIONS.SITE_CREATE, ACTIONS.SITE_REQUEST_READ, ACTIONS.SITE_REQUEST_DECIDE]);
  const login = await request(app).post("/v1/auth/login").send({ identifier: "tuser", password: "ChangeMe123" });
  return login.body.data.accessToken;
}

async function makeTenantOrg(code = "TEN1"): Promise<string> {
  const t = await Organization.create({
    name: `Tenant ${code}`, code, type: "Tenant", status: "Active",
    parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: "ID", address: null,
  });
  return t.id;
}

describe("sites", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("requires authentication", async () => {
    const res = await request(app).get("/v1/sites");
    expect(res.status).toBe(401);
  });

  it("forbids a non-Service-Owner even with grants", async () => {
    const soToken = await soLogin();
    const orgId = await makeTenantOrg();
    const token = await tenantWithGrants();
    const res = await request(app).post("/v1/sites").set(bearer(token)).send({ orgId, name: "HQ" });
    expect(res.status).toBe(403);
    void soToken;
  });

  it("creates a site with an auto-generated code and tenant name", async () => {
    const token = await soLogin();
    const orgId = await makeTenantOrg("TEN1");
    const res = await request(app).post("/v1/sites").set(bearer(token))
      .send({ orgId, name: "Head Office", type: "Head Office", isPrimary: true, country: "ID" });
    expect(res.status).toBe(201);
    expect(res.body.data.code).toMatch(/^STE-\d+$/);
    expect(res.body.data.tenantName).toBe("Tenant TEN1");
    expect(res.body.data.isPrimary).toBe(true);
  });

  it("rejects a site for a non-tenant organization", async () => {
    const token = await soLogin();
    const so = await Organization.findOne({ where: { type: "ServiceOwner" } });
    const res = await request(app).post("/v1/sites").set(bearer(token)).send({ orgId: so!.id, name: "X" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("NOT_A_TENANT");
  });

  it("keeps only one primary site per tenant", async () => {
    const token = await soLogin();
    const orgId = await makeTenantOrg("TEN1");
    const a = await request(app).post("/v1/sites").set(bearer(token)).send({ orgId, name: "A", isPrimary: true });
    await request(app).post("/v1/sites").set(bearer(token)).send({ orgId, name: "B", isPrimary: true });
    const list = await request(app).get(`/v1/sites?orgId=${orgId}`).set(bearer(token));
    const primaries = list.body.data.filter((s: { isPrimary: boolean }) => s.isPrimary);
    expect(primaries).toHaveLength(1);
    expect(primaries[0].name).toBe("B");
    void a;
  });

  it("refuses to delete the primary site", async () => {
    const token = await soLogin();
    const orgId = await makeTenantOrg("TEN1");
    const site = await request(app).post("/v1/sites").set(bearer(token)).send({ orgId, name: "HQ", isPrimary: true });
    const del = await request(app).delete(`/v1/sites/${site.body.data.id}`).set(bearer(token));
    expect(del.status).toBe(409);
    expect(del.body.error.code).toBe("PRIMARY_SITE");
  });

  it("filters sites by tenant org", async () => {
    const token = await soLogin();
    const orgA = await makeTenantOrg("TENA");
    const orgB = await makeTenantOrg("TENB");
    await request(app).post("/v1/sites").set(bearer(token)).send({ orgId: orgA, name: "A1" });
    await request(app).post("/v1/sites").set(bearer(token)).send({ orgId: orgB, name: "B1" });
    const list = await request(app).get(`/v1/sites?orgId=${orgA}`).set(bearer(token));
    expect(list.body.data.map((s: { name: string }) => s.name)).toEqual(["A1"]);
  });
});

describe("site requests + provisioning", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("creates an addition request and provisions it into a site", async () => {
    const token = await soLogin();
    const orgId = await makeTenantOrg("TEN1");
    const req = await request(app).post("/v1/site-requests").set(bearer(token)).send({
      orgId, type: "Site Addition", requestedBy: "Tenant",
      proposed: { name: "Warehouse 2", siteType: "Warehouse", country: "ID" }, reason: "Expansion",
    });
    expect(req.status).toBe(201);
    expect(req.body.data.code).toMatch(/^SRQ-\d+$/);
    expect(req.body.data.status).toBe("Submitted");

    const approve = await request(app).post(`/v1/site-requests/${req.body.data.id}/approve`).set(bearer(token));
    expect(approve.status).toBe(200);
    expect(approve.body.data.status).toBe("Approved");
    expect(approve.body.data.provisioned).toBe(false);

    const prov = await request(app).post(`/v1/site-requests/${req.body.data.id}/provision`).set(bearer(token));
    expect(prov.status).toBe(200);
    expect(prov.body.data.provisioned).toBe(true);
    expect(prov.body.data.provisionedSiteId).toBeTruthy();

    const sites = await request(app).get(`/v1/sites?orgId=${orgId}`).set(bearer(token));
    expect(sites.body.data.map((s: { name: string }) => s.name)).toContain("Warehouse 2");
  });

  it("applies a change request immediately on approval", async () => {
    const token = await soLogin();
    const orgId = await makeTenantOrg("TEN1");
    const site = await request(app).post("/v1/sites").set(bearer(token)).send({ orgId, name: "Old Name" });
    const req = await request(app).post("/v1/site-requests").set(bearer(token)).send({
      orgId, type: "Site Change", siteId: site.body.data.id, proposed: { name: "New Name" }, reason: "Rename",
    });
    await request(app).post(`/v1/site-requests/${req.body.data.id}/approve`).set(bearer(token));
    const got = await request(app).get(`/v1/sites/${site.body.data.id}`).set(bearer(token));
    expect(got.body.data.name).toBe("New Name");
  });

  it("closes a non-primary site on approval but blocks closing the primary", async () => {
    const token = await soLogin();
    const orgId = await makeTenantOrg("TEN1");
    const primary = await request(app).post("/v1/sites").set(bearer(token)).send({ orgId, name: "HQ", isPrimary: true });
    const branch = await request(app).post("/v1/sites").set(bearer(token)).send({ orgId, name: "Branch" });

    const closeBranch = await request(app).post("/v1/site-requests").set(bearer(token))
      .send({ orgId, type: "Site Closure", siteId: branch.body.data.id, reason: "Closing" });
    await request(app).post(`/v1/site-requests/${closeBranch.body.data.id}/approve`).set(bearer(token));
    const gotBranch = await request(app).get(`/v1/sites/${branch.body.data.id}`).set(bearer(token));
    expect(gotBranch.body.data.status).toBe("Inactive");

    const closePrimary = await request(app).post("/v1/site-requests").set(bearer(token))
      .send({ orgId, type: "Site Closure", siteId: primary.body.data.id, reason: "Nope" });
    const res = await request(app).post(`/v1/site-requests/${closePrimary.body.data.id}/approve`).set(bearer(token));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("PRIMARY_SITE");
  });

  it("only provisions approved additions", async () => {
    const token = await soLogin();
    const orgId = await makeTenantOrg("TEN1");
    const req = await request(app).post("/v1/site-requests").set(bearer(token))
      .send({ orgId, type: "Site Addition", proposed: { name: "X" } });
    const prov = await request(app).post(`/v1/site-requests/${req.body.data.id}/provision`).set(bearer(token));
    expect(prov.status).toBe(409);
    expect(prov.body.error.code).toBe("NOT_APPROVED");
  });
});
