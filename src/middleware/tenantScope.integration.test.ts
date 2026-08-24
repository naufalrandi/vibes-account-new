import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../app";
import { initModels, Organization, User, Role, SaasSubscription, SaasWorkspace } from "../db/models";
import { hashPassword } from "../lib/password";
import { resetDb, grantActions } from "../../test/helpers";
import { ACTIONS } from "../modules/iam/actions.catalog";

const app = createApp();
const authed = (t: string) => ({ Authorization: `Bearer ${t}` });
const DAY_MS = 86400000;
let seq = 0;

/** A Tenant org + one admin user (org.read + org.update granted) + login. */
async function seedTenant(name = "PT Hammer Global"): Promise<{ token: string; tenant: Organization }> {
  seq += 1;
  const tenant = await Organization.create({
    name, code: `TNT${seq}`, type: "Tenant", status: "Active",
    parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null,
  });
  tenant.tenantId = tenant.id;
  await tenant.save();
  const user = await User.create({
    orgId: tenant.id, tenantId: tenant.id, fullName: "Tenant Admin", username: `tnadmin${seq}`,
    email: `tnadmin${seq}@hammer.io`, passwordHash: await hashPassword("ChangeMe123"), status: "Active",
    position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null,
  });
  const role = await Role.create({ name: "Tenant Admin", tierScope: "Tenant", orgId: tenant.id, isSuperAdmin: false, status: true });
  await (user as unknown as { setRoles: (r: Role[]) => Promise<unknown> }).setRoles([role]);
  await grantActions(role.id, [ACTIONS.ORG_READ, ACTIONS.ORG_UPDATE]);
  const login = await request(app).post("/v1/auth/login").send({ identifier: `tnadmin${seq}`, password: "ChangeMe123" });
  return { token: login.body.data.accessToken, tenant };
}

/** Provisions one saas_workspaces + saas_subscriptions row for a tenant, `renewalDate` days ago. */
async function seedWorkspace(tenantId: string, daysPastRenewal: number): Promise<void> {
  seq += 1;
  const renewalDate = new Date(Date.now() - daysPastRenewal * DAY_MS);
  const sub = await SaasSubscription.create({
    code: `SUB-${seq}`, tenantId, pipelineId: null, partnerId: null, products: ["ms"],
    startDate: new Date(Date.now() - 400 * DAY_MS), renewalDate, lastPaymentAt: new Date(Date.now() - 400 * DAY_MS),
    amount: 36000000, currency: "IDR", paymentMethod: "Bank Transfer", ccAdequateLimit: false, autoRenew: false,
    term: "12 months", status: "Active", graceStartedAt: null, archivedAt: null, audit: [],
  });
  await SaasWorkspace.create({
    code: `WS-${seq}`, tenantId, subId: sub.id, product: "ms", name: "Management System",
    standard: "ISO 9001", status: "Active", provisionedAt: new Date(Date.now() - 400 * DAY_MS), audit: [],
  });
}

describe("tenantScope — SaaS lifecycle enforcement (G-75)", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("a legacy tenant with no saas_workspaces row keeps full access", async () => {
    const { token } = await seedTenant();
    const res = await request(app).patch("/v1/org-settings").set(authed(token)).send({ name: "Renamed Co" });
    expect(res.status).toBe(200);
  });

  it("Grace 1 (Read-only): reads are allowed; a write is refused (403) and the row is unchanged", async () => {
    const { token, tenant } = await seedTenant();
    await seedWorkspace(tenant.id, 10); // 10 days past renewal -> within 30d Grace 1

    const get = await request(app).get("/v1/org-settings").set(authed(token));
    expect(get.status).toBe(200);

    const write = await request(app).patch("/v1/org-settings").set(authed(token)).send({ name: "Should Not Apply" });
    expect(write.status).toBe(403);
    expect(write.body.error.code).toBe("SUBSCRIPTION_READONLY");

    const reloaded = await Organization.findByPk(tenant.id);
    expect(reloaded?.name).toBe("PT Hammer Global");
  });

  it("Grace 2 (Locked): every request is refused (423), including reads, and the row is unchanged", async () => {
    const { token, tenant } = await seedTenant();
    await seedWorkspace(tenant.id, 40); // 40 days past renewal -> past Grace 1 (30d), within Grace 2 (next 30d)

    const get = await request(app).get("/v1/org-settings").set(authed(token));
    expect(get.status).toBe(423);
    expect(get.body.error.code).toBe("SUBSCRIPTION_LOCKED");

    const write = await request(app).patch("/v1/org-settings").set(authed(token)).send({ name: "Should Not Apply" });
    expect(write.status).toBe(423);
    expect(write.body.error.code).toBe("SUBSCRIPTION_LOCKED");

    const reloaded = await Organization.findByPk(tenant.id);
    expect(reloaded?.name).toBe("PT Hammer Global");
  });

  it("Archived (past both grace windows, within 12mo retention): still fully refused", async () => {
    const { token, tenant } = await seedTenant();
    await seedWorkspace(tenant.id, 100); // past 60d of combined grace, well within 12mo retention

    const res = await request(app).get("/v1/org-settings").set(authed(token));
    expect(res.status).toBe(423);

    const write = await request(app).patch("/v1/org-settings").set(authed(token)).send({ name: "Should Not Apply" });
    expect(write.status).toBe(423);
    const reloaded = await Organization.findByPk(tenant.id);
    expect(reloaded?.name).toBe("PT Hammer Global");
  });

  it("locking one tenant does not affect a different tenant (no cross-tenant leakage)", async () => {
    const locked = await seedTenant("PT Locked Co");
    await seedWorkspace(locked.tenant.id, 40); // Grace 2 / Locked
    const clean = await seedTenant("PT Clean Co");

    const lockedRes = await request(app).get("/v1/org-settings").set(authed(locked.token));
    expect(lockedRes.status).toBe(423);

    const cleanRes = await request(app).patch("/v1/org-settings").set(authed(clean.token)).send({ name: "Still Fine" });
    expect(cleanRes.status).toBe(200);
  });

  it("does not gate ServiceOwner staff, even acting on their own org while an unrelated tenant is locked", async () => {
    const locked = await seedTenant("PT Locked Co");
    await seedWorkspace(locked.tenant.id, 40);

    seq += 1;
    const so = await Organization.create({
      name: "AXIA", code: `AXIA${seq}`, type: "ServiceOwner", status: "Active",
      parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null,
    });
    const soUser = await User.create({
      orgId: so.id, tenantId: null, fullName: "SO Admin", username: `soadmin${seq}`, email: `soadmin${seq}@axia.io`,
      passwordHash: await hashPassword("ChangeMe123"), status: "Active", position: null, workUnit: null,
      lastLogin: null, activationToken: null, resetToken: null, resetExpires: null,
    });
    const soRole = await Role.create({ name: "SO", tierScope: "ServiceOwner", orgId: so.id, isSuperAdmin: false, status: true });
    await (soUser as unknown as { setRoles: (r: Role[]) => Promise<unknown> }).setRoles([soRole]);
    await grantActions(soRole.id, [ACTIONS.ORG_READ, ACTIONS.ORG_UPDATE]);
    const soLogin = await request(app).post("/v1/auth/login").send({ identifier: `soadmin${seq}`, password: "ChangeMe123" });

    const res = await request(app)
      .patch("/v1/org-settings")
      .set(authed(soLogin.body.data.accessToken))
      .send({ name: "AXIA Renamed" });
    expect(res.status).toBe(200);
  });
});
