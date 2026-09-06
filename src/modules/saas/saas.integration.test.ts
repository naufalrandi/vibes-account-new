import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import { initModels, Organization, User, Role, SaasPipeline, SaasSubscription, SaasWorkspace } from "../../db/models";
import { hashPassword } from "../../lib/password";
import { resetDb, grantActions } from "../../../test/helpers";
import { ACTIONS } from "../iam/actions.catalog";

const app = createApp();
const authed = (t: string) => ({ Authorization: `Bearer ${t}` });
const DAY_MS = 86400000;
let seq = 0;

async function seedServiceOwner(actions: string[]): Promise<{ token: string; org: Organization }> {
  seq += 1;
  const org = await Organization.create({
    name: "AXIA", code: `AXIA${seq}`, type: "ServiceOwner", status: "Active",
    parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null,
  });
  const user = await User.create({
    orgId: org.id, tenantId: null, fullName: "SO Admin", username: `soadmin${seq}`, email: `soadmin${seq}@axia.io`,
    passwordHash: await hashPassword("ChangeMe123"), status: "Active", position: null, workUnit: null,
    lastLogin: null, activationToken: null, resetToken: null, resetExpires: null,
  });
  const role = await Role.create({ name: "SO", tierScope: "ServiceOwner", orgId: org.id, isSuperAdmin: false, status: true });
  await (user as unknown as { setRoles: (r: Role[]) => Promise<unknown> }).setRoles([role]);
  await grantActions(role.id, actions);
  const login = await request(app).post("/v1/auth/login").send({ identifier: `soadmin${seq}`, password: "ChangeMe123" });
  return { token: login.body.data.accessToken, org };
}

async function seedTenant(): Promise<{ token: string; tenant: Organization }> {
  seq += 1;
  const tenant = await Organization.create({
    name: "PT Hammer Global", code: `TNT${seq}`, type: "Tenant", status: "Active",
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

async function seedWorkspace(tenantId: string, daysPastRenewal: number): Promise<{ sub: SaasSubscription; ws: SaasWorkspace }> {
  seq += 1;
  const renewalDate = new Date(Date.now() - daysPastRenewal * DAY_MS);
  const sub = await SaasSubscription.create({
    code: `SUB-${seq}`, tenantId, pipelineId: null, partnerId: null, products: ["ms"],
    startDate: new Date(Date.now() - 400 * DAY_MS), renewalDate, lastPaymentAt: new Date(Date.now() - 400 * DAY_MS),
    amount: 36000000, currency: "IDR", paymentMethod: "Bank Transfer", ccAdequateLimit: false, autoRenew: false,
    term: "12 months", status: "Active", graceStartedAt: null, archivedAt: null, audit: [],
  });
  const ws = await SaasWorkspace.create({
    code: `WS-${seq}`, tenantId, subId: sub.id, product: "ms", name: "Management System",
    standard: "ISO 9001", status: "Active", provisionedAt: new Date(Date.now() - 400 * DAY_MS), audit: [],
  });
  return { sub, ws };
}

describe("saas lifecycle module (G-73)", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("requires saas.read to list pipeline/subscriptions/workspaces", async () => {
    const { token } = await seedServiceOwner([]); // no grants
    for (const path of ["/v1/saas/pipeline", "/v1/saas/subscriptions", "/v1/saas/workspaces"]) {
      const res = await request(app).get(path).set(authed(token));
      expect(res.status).toBe(403);
    }
  });

  it("creates a pipeline quote with an auto-generated PIPE-#### code and lists it", async () => {
    const { token } = await seedServiceOwner([ACTIONS.SAAS_READ, ACTIONS.SAAS_MANAGE]);
    const create = await request(app).post("/v1/saas/pipeline").set(authed(token)).send({
      tenantName: "PT Roxxon Energy", industry: "Energy", contactEmail: "dario@roxxon.co.id",
      items: [{ product: "ms" }], amount: 36000000,
    });
    expect(create.status).toBe(201);
    expect(create.body.data.code).toMatch(/^PIPE-\d{4}$/);
    expect(create.body.data.stage).toBe("Quote Sent");
    expect(create.body.data.type).toBe("New Tenant / SaaS"); // OD `pq-type` default

    const list = await request(app).get("/v1/saas/pipeline").set(authed(token));
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);

    const get = await request(app).get(`/v1/saas/pipeline/${create.body.data.id}`).set(authed(token));
    expect(get.status).toBe(200);
    expect(get.body.data.tenantName).toBe("PT Roxxon Energy");
  });

  it("round-trips an 'Add-on: SaaS' request type and rejects any other value (OD `pq-type`)", async () => {
    const { token } = await seedServiceOwner([ACTIONS.SAAS_READ, ACTIONS.SAAS_MANAGE]);
    const base = { tenantName: "PT Roxxon Energy", items: [{ product: "lab" }], amount: 48000000 };

    const create = await request(app).post("/v1/saas/pipeline").set(authed(token)).send({ ...base, type: "Add-on: SaaS" });
    expect(create.status).toBe(201);
    expect(create.body.data.type).toBe("Add-on: SaaS");

    const get = await request(app).get(`/v1/saas/pipeline/${create.body.data.id}`).set(authed(token));
    expect(get.body.data.type).toBe("Add-on: SaaS");

    const bad = await request(app).post("/v1/saas/pipeline").set(authed(token)).send({ ...base, type: "Renewal" });
    expect(bad.status).toBe(400);
  });

  it("rejects pipeline/renew writes from a non-ServiceOwner caller even if somehow granted saas.manage (defence in depth)", async () => {
    seq += 1;
    const dist = await Organization.create({
      name: "Nusantara", code: `NPART${seq}`, type: "Distributor", status: "Active",
      parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null,
    });
    const user = await User.create({
      orgId: dist.id, tenantId: null, fullName: "Partner Admin", username: `partner${seq}`, email: `partner${seq}@nusantara.id`,
      passwordHash: await hashPassword("ChangeMe123"), status: "Active", position: null, workUnit: null,
      lastLogin: null, activationToken: null, resetToken: null, resetExpires: null,
    });
    const role = await Role.create({ name: "Partner Admin", tierScope: "Distributor", orgId: dist.id, isSuperAdmin: false, status: true });
    await (user as unknown as { setRoles: (r: Role[]) => Promise<unknown> }).setRoles([role]);
    await grantActions(role.id, [ACTIONS.SAAS_READ, ACTIONS.SAAS_MANAGE]); // misconfigured grant
    const login = await request(app).post("/v1/auth/login").send({ identifier: `partner${seq}`, password: "ChangeMe123" });

    const res = await request(app).post("/v1/saas/pipeline").set(authed(login.body.data.accessToken)).send({
      tenantName: "Should Be Rejected", items: [{ product: "ms" }], amount: 1000,
    });
    expect(res.status).toBe(403);
    expect(await SaasPipeline.count()).toBe(0);
  });

  it("refuses cross-tenant SaaS reads to a tenant's own super-admin role (isSuperAdmin bypasses requireAction)", async () => {
    seq += 1;
    const other = await Organization.create({
      name: "PT Other Tenant", code: `OTH${seq}`, type: "Tenant", status: "Active",
      parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null,
    });
    other.tenantId = other.id;
    await other.save();
    await seedWorkspace(other.id, 0); // another tenant's commercial data

    const tenant = await Organization.create({
      name: "PT Snooper", code: `SNP${seq}`, type: "Tenant", status: "Active",
      parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null,
    });
    tenant.tenantId = tenant.id;
    await tenant.save();
    const user = await User.create({
      orgId: tenant.id, tenantId: tenant.id, fullName: "Snoop", username: `snoop${seq}`, email: `snoop${seq}@snooper.io`,
      passwordHash: await hashPassword("ChangeMe123"), status: "Active", position: null, workUnit: null,
      lastLogin: null, activationToken: null, resetToken: null, resetExpires: null,
    });
    // A super-admin role inside a tenant: `requireAction` waves it through, so
    // the SaaS boundary has to come from the JWT's org type, not from grants.
    const role = await Role.create({ name: "Tenant Super", tierScope: "Tenant", orgId: tenant.id, isSuperAdmin: true, status: true });
    await (user as unknown as { setRoles: (r: Role[]) => Promise<unknown> }).setRoles([role]);
    const login = await request(app).post("/v1/auth/login").send({ identifier: `snoop${seq}`, password: "ChangeMe123" });

    for (const path of ["/v1/saas/pipeline", "/v1/saas/subscriptions", "/v1/saas/workspaces"]) {
      const res = await request(app).get(path).set(authed(login.body.data.accessToken));
      expect(res.status).toBe(403);
      expect(JSON.stringify(res.body)).not.toContain("PT Other Tenant");
    }
  });

  it("lists subscriptions/workspaces with the derived lifecycle state (not persisted)", async () => {
    const { token } = await seedServiceOwner([ACTIONS.SAAS_READ]);
    const { tenant } = await seedTenant();
    const { sub, ws } = await seedWorkspace(tenant.id, 40); // Grace 2 / Locked

    const subs = await request(app).get("/v1/saas/subscriptions").set(authed(token));
    expect(subs.status).toBe(200);
    expect(subs.body.data[0].state).toBe("Grace 2");

    const workspaces = await request(app).get("/v1/saas/workspaces").set(authed(token));
    expect(workspaces.status).toBe(200);
    expect(workspaces.body.data[0].state).toBe("Locked");
    expect(workspaces.body.data[0].access).toBe("none");

    // Persisted rows are untouched by view-only derivation.
    const reloadedSub = await SaasSubscription.findByPk(sub.id);
    expect(reloadedSub?.status).toBe("Active"); // raw status column never mutated by reads
    const reloadedWs = await SaasWorkspace.findByPk(ws.id);
    expect(reloadedWs?.status).toBe("Active");
  });

  // R468 — the frontend renders OD's grace bar / lockout card from this route,
  // so it has to answer even while `tenantScope` is refusing everything else.
  it("reports the caller's own SaaS access, and still answers a locked-out tenant", async () => {
    const { token: tnToken, tenant } = await seedTenant();
    const { token: soToken } = await seedServiceOwner([ACTIONS.SAAS_READ]);

    const full = await request(app).get("/v1/saas-access").set(authed(tnToken));
    expect(full.status).toBe(200);
    expect(full.body.data.access).toBe("full");

    await seedWorkspace(tenant.id, 40); // Grace 2 / Locked
    expect((await request(app).get("/v1/org-settings").set(authed(tnToken))).status).toBe(423);

    const locked = await request(app).get("/v1/saas-access").set(authed(tnToken));
    expect(locked.status).toBe(200);
    expect(locked.body.data.access).toBe("none");
    expect(locked.body.data.wsState).toBe("Locked");
    expect(locked.body.data.subState.state).toBe("Grace 2");
    expect(locked.body.data.tenantName).toBe(tenant.name);

    // Service-provider staff are never grace-gated.
    const sp = await request(app).get("/v1/saas-access").set(authed(soToken));
    expect(sp.body.data.access).toBe("full");
  });

  it("renewing a lapsed subscription lifts the G-75 lockout for that tenant", async () => {
    const { token: soToken } = await seedServiceOwner([ACTIONS.SAAS_READ, ACTIONS.SAAS_MANAGE]);
    const { token: tnToken, tenant } = await seedTenant();
    const { sub } = await seedWorkspace(tenant.id, 40); // Grace 2 / Locked

    // The tenant is locked out before renewal.
    const before = await request(app).get("/v1/org-settings").set(authed(tnToken));
    expect(before.status).toBe(423);

    const renew = await request(app).post(`/v1/saas/subscriptions/${sub.id}/renew`).set(authed(soToken));
    expect(renew.status).toBe(200);
    expect(renew.body.data.state).toBe("Active");
    expect(renew.body.data.status).toBe("Active");
    expect(new Date(renew.body.data.renewalDate).getTime()).toBeGreaterThan(Date.now());

    const reloaded = await SaasSubscription.findByPk(sub.id);
    expect(reloaded?.status).toBe("Active");
    expect(reloaded?.graceStartedAt).toBeNull();
    expect(reloaded?.archivedAt).toBeNull();

    // The tenant regains access without any change on their side.
    const after = await request(app).get("/v1/org-settings").set(authed(tnToken));
    expect(after.status).toBe(200);
  });
});
