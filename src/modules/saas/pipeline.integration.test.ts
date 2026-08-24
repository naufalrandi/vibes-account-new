import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import {
  initModels, Organization, User, Role, SaasPipeline, SaasSubscription, SaasWorkspace,
  TenantProfile, Site, AuditLog,
} from "../../db/models";
import { hashPassword } from "../../lib/password";
import { resetDb, grantActions } from "../../../test/helpers";
import { ACTIONS } from "../iam/actions.catalog";

/**
 * Covers the pipeline write-side stage machine added on top of G-73's
 * read-only listing/quote-creation/renewal (saas.integration.test.ts):
 * accept -> registration -> upload proof -> verify payment -> provision.
 * See pipeline.transitions.ts for the stage/action legality table this
 * suite is proving — the point of a stage machine is what it refuses, so
 * most of this file is illegal-transition and provisioning-failure cases,
 * not just the happy path.
 */
const app = createApp();
const authed = (t: string) => ({ Authorization: `Bearer ${t}` });
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

async function createQuote(token: string): Promise<string> {
  const res = await request(app).post("/v1/saas/pipeline").set(authed(token)).send({
    tenantName: "PT Roxxon Energy", industry: "Energy", contactEmail: "dario@roxxon.co.id",
    items: [{ product: "ms" }], amount: 36000000,
  });
  expect(res.status).toBe(201);
  return res.body.data.id as string;
}

/** Walks a fresh quote through accept -> registration -> proof -> verify, landing on 'Verified'. */
async function walkToVerified(token: string): Promise<string> {
  const id = await createQuote(token);
  await request(app).post(`/v1/saas/pipeline/${id}/accept`).set(authed(token)).expect(200);
  const reg = await request(app).post(`/v1/saas/pipeline/${id}/registration`).set(authed(token)).send({
    legalName: "PT Roxxon Energy Legal", adminName: "Dario Agger", adminEmail: "dario@roxxon.co.id", termsAccepted: true,
  });
  expect(reg.status).toBe(200);
  await request(app).post(`/v1/saas/pipeline/${id}/proof`).set(authed(token)).send({ proofUrl: "BCA-transfer.pdf" }).expect(200);
  const verify = await request(app).post(`/v1/saas/pipeline/${id}/verify`).set(authed(token));
  expect(verify.status).toBe(200);
  expect(verify.body.data.stage).toBe("Verified");
  return id;
}

describe("saas pipeline stage transitions (G-73 write side)", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("walks the full funnel quote -> accept -> registration -> proof -> verify -> provision", async () => {
    const { token } = await seedServiceOwner([ACTIONS.SAAS_READ, ACTIONS.SAAS_MANAGE]);
    const id = await createQuote(token);

    const accept = await request(app).post(`/v1/saas/pipeline/${id}/accept`).set(authed(token));
    expect(accept.status).toBe(200);
    expect(accept.body.data.stage).toBe("Registration");
    expect(accept.body.data.audit[0].msg).toBe("Quote accepted — registration opened");

    const reg = await request(app).post(`/v1/saas/pipeline/${id}/registration`).set(authed(token)).send({
      legalName: "PT Roxxon Energy Legal", adminName: "Dario Agger", adminEmail: "dario@roxxon.co.id",
      adminUser: "dario.agger", termsAccepted: true,
    });
    expect(reg.status).toBe(200);
    expect(reg.body.data.stage).toBe("Awaiting Transfer");
    expect(reg.body.data.registrationComplete).toBe(true);
    expect(reg.body.data.payment.state).toBe("Awaiting Transfer");
    expect(reg.body.data.payment.invoiceNo).toMatch(/^INV-\d{4}$/);

    const proof = await request(app).post(`/v1/saas/pipeline/${id}/proof`).set(authed(token)).send({ proofUrl: "BCA-2026-07.pdf" });
    expect(proof.status).toBe(200);
    expect(proof.body.data.stage).toBe("Under Verification");
    expect(proof.body.data.payment.proofUrl).toBe("BCA-2026-07.pdf");

    const verify = await request(app).post(`/v1/saas/pipeline/${id}/verify`).set(authed(token));
    expect(verify.status).toBe(200);
    expect(verify.body.data.stage).toBe("Verified");
    expect(verify.body.data.payment.state).toBe("Verified");
    expect(verify.body.data.payment.verifiedBy).toBe("SO Admin");

    const provision = await request(app).post(`/v1/saas/pipeline/${id}/provision`).set(authed(token));
    expect(provision.status).toBe(200);
    expect(provision.body.data.stage).toBe("Completed");
    expect(provision.body.data.tenantId).toBeTruthy();
    expect(provision.body.data.subId).toBeTruthy();
    expect(provision.body.data.audit[0].msg).toBe("Provisioned — 1 workspace(s) activated");

    const tenantId = provision.body.data.tenantId as string;
    const org = await Organization.findByPk(tenantId);
    expect(org?.type).toBe("Tenant");
    expect(org?.name).toBe("PT Roxxon Energy Legal");
    expect(await TenantProfile.count({ where: { orgId: tenantId } })).toBe(1);
    expect(await Site.count({ where: { orgId: tenantId, isPrimary: true } })).toBe(1);
    const admin = await User.findOne({ where: { orgId: tenantId } });
    expect(admin?.username).toBe("dario.agger");
    expect(admin?.email).toBe("dario@roxxon.co.id");

    const sub = await SaasSubscription.findByPk(provision.body.data.subId as string);
    expect(sub?.tenantId).toBe(tenantId);
    expect(sub?.pipelineId).toBe(id);
    expect(sub?.products).toEqual(["ms"]);

    const workspaces = await SaasWorkspace.findAll({ where: { tenantId } });
    expect(workspaces).toHaveLength(1);
    expect(workspaces[0].product).toBe("ms");
    expect(workspaces[0].subId).toBe(sub?.id);
  });

  it("rejects accept/decline once a quote has already been accepted (stage no longer 'Quote Sent')", async () => {
    const { token } = await seedServiceOwner([ACTIONS.SAAS_READ, ACTIONS.SAAS_MANAGE]);
    const id = await createQuote(token);
    await request(app).post(`/v1/saas/pipeline/${id}/accept`).set(authed(token)).expect(200);

    const reAccept = await request(app).post(`/v1/saas/pipeline/${id}/accept`).set(authed(token));
    expect(reAccept.status).toBe(409);
    expect(reAccept.body.error.code).toBe("SAAS_PIPELINE_ILLEGAL_TRANSITION");

    const decline = await request(app).post(`/v1/saas/pipeline/${id}/decline`).set(authed(token));
    expect(decline.status).toBe(409);

    const reloaded = await SaasPipeline.findByPk(id);
    expect(reloaded?.stage).toBe("Registration"); // untouched by either rejected call
  });

  it("rejects uploading proof before registration is complete", async () => {
    const { token } = await seedServiceOwner([ACTIONS.SAAS_READ, ACTIONS.SAAS_MANAGE]);
    const id = await createQuote(token); // stage: Quote Sent

    const res = await request(app).post(`/v1/saas/pipeline/${id}/proof`).set(authed(token)).send({ proofUrl: "x.pdf" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("SAAS_PIPELINE_ILLEGAL_TRANSITION");
  });

  it("rejects provisioning a quote that hasn't reached payment verification (structural: wrong stage)", async () => {
    const { token } = await seedServiceOwner([ACTIONS.SAAS_READ, ACTIONS.SAAS_MANAGE]);
    const id = await createQuote(token); // stage: Quote Sent, no payment at all

    const res = await request(app).post(`/v1/saas/pipeline/${id}/provision`).set(authed(token));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("SAAS_PIPELINE_ILLEGAL_TRANSITION");
    expect(await Organization.count({ where: { type: "Tenant" } })).toBe(0);
  });

  it("refuses to provision when the stage allows it but payment was never actually verified (ported OD guard)", async () => {
    const { token } = await seedServiceOwner([ACTIONS.SAAS_READ, ACTIONS.SAAS_MANAGE]);
    // Seeded directly at 'Verified' with an inconsistent payment state — the
    // only way to reach this combination is a direct data edit, but the
    // service must still refuse it rather than trust the stage alone.
    const row = await SaasPipeline.create({
      code: "PIPE-9001", tenantId: null, tenantName: "Inconsistent Co", partnerId: null, industry: null,
      country: "ID", contactPerson: "Someone", contactEmail: "someone@example.com", contactPhone: null,
      type: "New Tenant / SaaS", stage: "Verified", items: [{ product: "ms" }], amount: 36000000, currency: "IDR",
      registrationComplete: true, registration: { legalName: "Inconsistent Co", adminName: "Someone", adminEmail: "someone@example.com" },
      payment: { method: "Bank Transfer", state: "Awaiting Transfer", invoiceNo: "INV-9001" },
      subId: null, audit: [],
    });

    const res = await request(app).post(`/v1/saas/pipeline/${row.id}/provision`).set(authed(token));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("SAAS_PAYMENT_NOT_VERIFIED");

    const reloaded = await SaasPipeline.findByPk(row.id);
    expect(reloaded?.stage).toBe("Verified"); // rejected before any provisioning attempt — not marked Failed
    expect(await Organization.count({ where: { type: "Tenant" } })).toBe(0);
  });

  it("rolls back the whole provisioning attempt atomically and marks the entry 'Provisioning Failed' on a mid-way DB error", async () => {
    const { token, org: soOrg } = await seedServiceOwner([ACTIONS.SAAS_READ, ACTIONS.SAAS_MANAGE]);
    const id = await walkToVerified(token);

    // Force a real, deterministic failure partway through provisioning: the
    // primary-site code is derived from a raw Site.count() (mirrors
    // tenant.service.ts's provisionTenant), so seeding exactly one Site row
    // with the code the next provisioning attempt will compute
    // (STE-1001 + count=1 = STE-1002) collides on Site's unique `code` —
    // AFTER Organization + TenantProfile have already been written inside
    // the same transaction. This proves a half-created tenant cannot survive.
    // `orgId` must reference a real organization (sites.org_id has an FK) —
    // the seeded Service Owner org is a convenient, unrelated one to hang it on.
    await Site.create({
      orgId: soOrg.id, code: "STE-1002", name: "Pre-existing", type: "Head Office",
      country: null, address: null, city: null, state: null, postalCode: null,
      status: "Active", isPrimary: false, description: null, contactPerson: null, contactEmail: null, contactPhone: null,
    });

    const res = await request(app).post(`/v1/saas/pipeline/${id}/provision`).set(authed(token));
    expect(res.status).toBe(500);

    // Nothing from the failed attempt survived — including the tenant that
    // was, mid-transaction, successfully created before the Site collision.
    expect(await Organization.count({ where: { type: "Tenant" } })).toBe(0);
    expect(await TenantProfile.count()).toBe(0);
    expect(await Site.count()).toBe(1); // only the pre-seeded collision row
    expect(await SaasSubscription.count()).toBe(0);
    expect(await SaasWorkspace.count()).toBe(0);

    const reloaded = await SaasPipeline.findByPk(id);
    expect(reloaded?.stage).toBe("Provisioning Failed");
    expect(reloaded?.tenantId).toBeNull();
    expect(reloaded?.subId).toBeNull();
    expect(reloaded?.audit[0].msg).toMatch(/^Provisioning failed —/);

    const failureAudit = await AuditLog.findOne({ where: { action: "saas.pipeline.provisioningFailed", entityId: id } });
    expect(failureAudit).not.toBeNull();

    // The stage machine allows retrying a failed provisioning attempt (OD's
    // 'Retry' button, pipeRowActions app.html:10698) — remove the collision
    // and confirm the same entry can be provisioned successfully afterward.
    await Site.destroy({ where: { code: "STE-1002" } });
    const retry = await request(app).post(`/v1/saas/pipeline/${id}/provision`).set(authed(token));
    expect(retry.status).toBe(200);
    expect(retry.body.data.stage).toBe("Completed");
  });

  it("requires saas.manage (not just saas.read) for every write action", async () => {
    const { token: readOnly } = await seedServiceOwner([ACTIONS.SAAS_READ]);
    const { token: manage } = await seedServiceOwner([ACTIONS.SAAS_READ, ACTIONS.SAAS_MANAGE]);
    const id = await createQuote(manage);

    const res = await request(app).post(`/v1/saas/pipeline/${id}/accept`).set(authed(readOnly));
    expect(res.status).toBe(403);
  });
});
