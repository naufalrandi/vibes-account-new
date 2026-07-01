import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import { initModels, Organization, User, Role, Site } from "../../db/models";
import { hashPassword } from "../../lib/password";
import { resetDb, grantActions } from "../../../test/helpers";
import { ACTIONS } from "../iam/actions.catalog";

const app = createApp();
const authed = (t: string) => ({ Authorization: `Bearer ${t}` });

const SITE_ACTIONS = [ACTIONS.SITE_READ, ACTIONS.SITE_CREATE, ACTIONS.SITE_UPDATE, ACTIONS.SITE_DELETE];
const REQ_ACTIONS = [ACTIONS.SITE_REQUEST_READ, ACTIONS.SITE_REQUEST_CREATE, ACTIONS.SITE_REQUEST_DECIDE];

/** A ServiceOwner (super-admin) plus a standalone Tenant org to attach sites to. */
async function setup(): Promise<{ token: string; tenantOrgId: string }> {
  const so = await Organization.create({
    name: "AXIA", code: "AXIA", type: "ServiceOwner", status: "Active",
    parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null,
  });
  const tenant = await Organization.create({
    name: "Acme", code: "ACME", type: "Tenant", status: "Active",
    parentOrgId: so.id, tenantId: null, email: null, phone: null, website: null, country: null, address: null,
  });
  tenant.tenantId = tenant.id;
  await tenant.save();
  const user = await User.create({
    orgId: so.id, tenantId: null, fullName: "SO", username: "soadmin", email: "soadmin@axia.io",
    passwordHash: await hashPassword("ChangeMe123"), status: "Active",
    position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null,
  });
  const role = await Role.create({ name: "SO", tierScope: "ServiceOwner", orgId: so.id, isSuperAdmin: false, status: true });
  await (user as unknown as { setRoles: (r: Role[]) => Promise<unknown> }).setRoles([role]);
  await grantActions(role.id, [...SITE_ACTIONS, ...REQ_ACTIONS]);
  const login = await request(app).post("/v1/auth/login").send({ identifier: "soadmin", password: "ChangeMe123" });
  return { token: login.body.data.accessToken, tenantOrgId: tenant.id };
}

describe("sites", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("rejects creating a site for a non-Tenant org", async () => {
    const { token } = await setup();
    const so = await Organization.findOne({ where: { code: "AXIA" } });
    const res = await request(app).post("/v1/sites").set(authed(token)).send({ orgId: so!.id, name: "Bad" });
    expect(res.status).toBe(400);
  });

  it("creates sites, enforces a single primary, and blocks deleting the primary", async () => {
    const { token, tenantOrgId } = await setup();
    const a = await request(app).post("/v1/sites").set(authed(token)).send({ orgId: tenantOrgId, name: "HQ", type: "Head Office", isPrimary: true });
    expect(a.status).toBe(201);
    expect(a.body.data.code).toMatch(/^STE-\d+$/);
    expect(a.body.data.isPrimary).toBe(true);

    const b = await request(app).post("/v1/sites").set(authed(token)).send({ orgId: tenantOrgId, name: "Plant", type: "Factory", isPrimary: true });
    expect(b.body.data.isPrimary).toBe(true);
    // Only one primary remains.
    expect(await Site.count({ where: { orgId: tenantOrgId, isPrimary: true } })).toBe(1);

    // Deleting the primary is blocked.
    const del = await request(app).delete(`/v1/sites/${b.body.data.id}`).set(authed(token));
    expect(del.status).toBe(400);
    // A non-primary deletes fine.
    expect((await request(app).delete(`/v1/sites/${a.body.data.id}`).set(authed(token))).status).toBe(200);
  });

  it("lists sites filtered by orgId", async () => {
    const { token, tenantOrgId } = await setup();
    await request(app).post("/v1/sites").set(authed(token)).send({ orgId: tenantOrgId, name: "HQ" });
    const res = await request(app).get(`/v1/sites?orgId=${tenantOrgId}`).set(authed(token));
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].tenantName).toBe("Acme");
  });
});

describe("site requests", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("Addition: submit → review → approve → provision creates a site", async () => {
    const { token, tenantOrgId } = await setup();
    const create = await request(app).post("/v1/site-requests").set(authed(token))
      .send({ orgId: tenantOrgId, type: "Site Addition", proposed: { name: "Warehouse West", siteType: "Warehouse", country: "ID" }, reason: "Expansion" });
    expect(create.status).toBe(201);
    expect(create.body.data.code).toMatch(/^SRQ-\d+$/);
    expect(create.body.data.status).toBe("Submitted");
    const id = create.body.data.id;

    expect((await request(app).post(`/v1/site-requests/${id}/review`).set(authed(token))).body.data.status).toBe("Under Review");
    expect((await request(app).post(`/v1/site-requests/${id}/approve`).set(authed(token))).body.data.status).toBe("Approved");
    const prov = await request(app).post(`/v1/site-requests/${id}/provision`).set(authed(token));
    expect(prov.body.data.provisioned).toBe(true);
    expect(prov.body.data.provisionedSiteId).toBeTruthy();
    // Provisioning is idempotent-guarded.
    expect((await request(app).post(`/v1/site-requests/${id}/provision`).set(authed(token))).status).toBe(409);

    const sites = await request(app).get(`/v1/sites?orgId=${tenantOrgId}`).set(authed(token));
    expect(sites.body.data.some((s: { name: string }) => s.name === "Warehouse West")).toBe(true);
  });

  it("Change: approve applies the proposed change to the target site", async () => {
    const { token, tenantOrgId } = await setup();
    const site = await request(app).post("/v1/sites").set(authed(token)).send({ orgId: tenantOrgId, name: "Old Name" });
    const req = await request(app).post("/v1/site-requests").set(authed(token))
      .send({ orgId: tenantOrgId, type: "Site Change", siteId: site.body.data.id, proposed: { name: "New Name" }, reason: "Rebrand" });
    await request(app).post(`/v1/site-requests/${req.body.data.id}/approve`).set(authed(token));
    const updated = await request(app).get(`/v1/sites/${site.body.data.id}`).set(authed(token));
    expect(updated.body.data.name).toBe("New Name");
  });

  it("Closure: blocked for the primary site", async () => {
    const { token, tenantOrgId } = await setup();
    const site = await request(app).post("/v1/sites").set(authed(token)).send({ orgId: tenantOrgId, name: "HQ", isPrimary: true });
    const req = await request(app).post("/v1/site-requests").set(authed(token))
      .send({ orgId: tenantOrgId, type: "Site Closure", siteId: site.body.data.id, reason: "n/a" });
    const res = await request(app).post(`/v1/site-requests/${req.body.data.id}/approve`).set(authed(token));
    expect(res.status).toBe(400);
  });

  it("requires a target site for change/closure", async () => {
    const { token, tenantOrgId } = await setup();
    const res = await request(app).post("/v1/site-requests").set(authed(token))
      .send({ orgId: tenantOrgId, type: "Site Change", proposed: { name: "x" } });
    expect(res.status).toBe(400);
  });
});
