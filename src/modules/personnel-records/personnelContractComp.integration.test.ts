import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import { initModels, Organization, User, Role, BusinessRecord } from "../../db/models";
import { hashPassword } from "../../lib/password";
import { resetDb, grantActions } from "../../../test/helpers";
import { ACTIONS } from "../iam/actions.catalog";

const app = createApp();

async function seedAdminAndTargetUser(): Promise<{ token: string; tenantOrgId: string; targetUserId: string }> {
  const tenant = await Organization.create({
    name: "Acme", code: "ACME2", type: "Tenant", status: "Active",
    parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null,
  });
  tenant.tenantId = tenant.id;
  await tenant.save();

  const admin = await User.create({
    orgId: tenant.id, tenantId: tenant.id, fullName: "Admin", username: "cadmin", email: "cadmin@acme.com",
    passwordHash: await hashPassword("ChangeMe123"), status: "Active",
    position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null,
  });
  const role = await Role.create({ name: "Administrator", tierScope: "Tenant", orgId: tenant.id, isSuperAdmin: true, status: true });
  await (admin as unknown as { setRoles: (r: Role[]) => Promise<unknown> }).setRoles([role]);

  const target = await User.create({
    orgId: tenant.id, tenantId: tenant.id, fullName: "Target Person", username: "cperson", email: "cperson@acme.com",
    passwordHash: null, status: "Active", position: null, workUnit: null, lastLogin: null,
    activationToken: null, resetToken: null, resetExpires: null,
  });

  const login = await request(app).post("/v1/auth/login").send({ identifier: "cadmin", password: "ChangeMe123" });
  return { token: login.body.data.accessToken, tenantOrgId: tenant.id, targetUserId: target.id };
}

async function seedDistributorActor(): Promise<{ token: string; outOfScopeUserId: string }> {
  const so = await Organization.create({
    name: "AXIA", code: "AXIA2", type: "ServiceOwner", status: "Active",
    parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null,
  });
  const dist = await Organization.create({
    name: "Northwind", code: "NWP2", type: "Distributor", status: "Active",
    parentOrgId: so.id, tenantId: null, email: null, phone: null, website: null, country: null, address: null,
  });
  const soUser = await User.create({
    orgId: so.id, tenantId: null, fullName: "SO Person", username: "sopersonc", email: "sopersonc@axia.io",
    passwordHash: null, status: "Active", position: null, workUnit: null, lastLogin: null,
    activationToken: null, resetToken: null, resetExpires: null,
  });
  const distAdmin = await User.create({
    orgId: dist.id, tenantId: null, fullName: "Dist Admin", username: "distadminc", email: "dac@nwp.io",
    passwordHash: await hashPassword("ChangeMe123"), status: "Active", position: null, workUnit: null,
    lastLogin: null, activationToken: null, resetToken: null, resetExpires: null,
  });
  const role = await Role.create({ name: "Administrator", tierScope: "Distributor", orgId: dist.id, isSuperAdmin: false, status: true });
  await (distAdmin as unknown as { setRoles: (r: Role[]) => Promise<unknown> }).setRoles([role]);
  await grantActions(role.id, [
    ACTIONS.PERSONNEL_CONTRACTDOC_READ, ACTIONS.PERSONNEL_CONTRACTDOC_MANAGE,
    ACTIONS.PERSONNEL_ACTIVITY_READ, ACTIONS.PERSONNEL_ACTIVITY_MANAGE,
    ACTIONS.PERSONNEL_ONBOARDING_READ, ACTIONS.PERSONNEL_ONBOARDING_MANAGE,
    ACTIONS.PERSONNEL_COMPENSATION_READ, ACTIONS.PERSONNEL_COMPENSATION_MANAGE,
  ]);
  const login = await request(app).post("/v1/auth/login").send({ identifier: "distadminc", password: "ChangeMe123" });
  return { token: login.body.data.accessToken, outOfScopeUserId: soUser.id };
}

describe("personnel contract documents / activity / onboarding / compensation", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("creates, updates and signs a contract document, logging activity along the way", async () => {
    const { token, targetUserId } = await seedAdminAndTargetUser();
    const bearer = { authorization: `Bearer ${token}` } as const;

    const created = await request(app).post(`/v1/users/${targetUserId}/contract-documents`).set(bearer).send({
      title: "Employment Contract",
      docType: "Employment",
      effectiveDate: "2026-01-01",
    });
    expect(created.status).toBe(201);
    expect(created.body.data.status).toBe("Draft");
    // OD `cdDraftContract` (js/modules.js:5257) drafts at version 0; only an edit
    // or `cdIssue` produces v1. Migration 0101 moved the column default to match.
    expect(created.body.data.version).toBe(0);

    const updated = await request(app)
      .put(`/v1/users/${targetUserId}/contract-documents/${created.body.data.id}`)
      .set(bearer)
      .send({ content: "Terms..." });
    expect(updated.status).toBe(200);
    expect(updated.body.data.version).toBe(1);

    const signed = await request(app).post(`/v1/users/${targetUserId}/contract-documents/${created.body.data.id}/sign`).set(bearer);
    expect(signed.status).toBe(200);
    expect(signed.body.data.status).toBe("Signed");
    expect(signed.body.data.signedAt).toBeTruthy();

    const activity = await request(app).get(`/v1/users/${targetUserId}/activity`).set(bearer);
    expect(activity.status).toBe(200);
    expect(activity.body.data.length).toBeGreaterThanOrEqual(3);
    expect(activity.body.data.map((a: { action: string }) => a.action)).toContain("contract_document.signed");
  });

  it("rejects a contract document with no title", async () => {
    const { token, targetUserId } = await seedAdminAndTargetUser();
    const res = await request(app).post(`/v1/users/${targetUserId}/contract-documents`).set("authorization", `Bearer ${token}`).send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("TITLE_REQUIRED");
  });

  it("posts a freeform activity entry", async () => {
    const { token, targetUserId } = await seedAdminAndTargetUser();
    const bearer = { authorization: `Bearer ${token}` } as const;

    const res = await request(app).post(`/v1/users/${targetUserId}/activity`).set(bearer).send({ action: "note.added", detail: "Welcome call done" });
    expect(res.status).toBe(201);
    expect(res.body.data[0].action).toBe("note.added");
  });

  it("seeds a default onboarding checklist on first read and toggles items", async () => {
    const { token, targetUserId } = await seedAdminAndTargetUser();
    const bearer = { authorization: `Bearer ${token}` } as const;

    const list = await request(app).get(`/v1/users/${targetUserId}/onboarding`).set(bearer);
    expect(list.status).toBe(200);
    expect(list.body.data.length).toBeGreaterThan(0);

    const item = list.body.data[0];
    const done = await request(app).put(`/v1/users/${targetUserId}/onboarding/${item.id}`).set(bearer).send({ done: true });
    expect(done.status).toBe(200);
    expect(done.body.data.done).toBe(true);
    expect(done.body.data.doneAt).toBeTruthy();
  });

  it("adds a custom onboarding item", async () => {
    const { token, targetUserId } = await seedAdminAndTargetUser();
    const bearer = { authorization: `Bearer ${token}` } as const;

    await request(app).get(`/v1/users/${targetUserId}/onboarding`).set(bearer);
    const added = await request(app).post(`/v1/users/${targetUserId}/onboarding`).set(bearer).send({ label: "Sign NDA" });
    expect(added.status).toBe(201);
    expect(added.body.data.label).toBe("Sign NDA");
  });

  it("binds compensation & bank fields and computes minimum-wage compliance", async () => {
    const { token, tenantOrgId, targetUserId } = await seedAdminAndTargetUser();
    const bearer = { authorization: `Bearer ${token}` } as const;

    const compRecord = await BusinessRecord.create({
      orgId: tenantOrgId, area: "enterprise", module: "ent-comp", code: "COMP-0001",
      title: "Base salary", status: "Active", owner: null, data: { amount: "5000000" },
    });
    const minwageRecord = await BusinessRecord.create({
      orgId: tenantOrgId, area: "enterprise", module: "ent-minwage", code: "MW-0001",
      title: "DKI Jakarta 2026", status: "Active", owner: null, data: { amount: "4900000" },
    });

    const bound = await request(app).put(`/v1/users/${targetUserId}/compensation`).set(bearer).send({
      compRecordId: compRecord.id,
      minwageRecordId: minwageRecord.id,
      bankName: "BCA",
      bankAccountNo: "1234567890",
      bankAccountName: "Target Person",
      taxId: "12.345.678.9-012.000",
    });
    expect(bound.status).toBe(200);
    expect(bound.body.data.minwageCompliant).toBe(true);
    expect(bound.body.data.bankName).toBe("BCA");

    const check = await request(app).get(`/v1/users/${targetUserId}/compensation/minwage-check`).set(bearer);
    expect(check.status).toBe(200);
    expect(check.body.data.compliant).toBe(true);
  });

  it("flags non-compliant compensation when below minimum wage", async () => {
    const { token, tenantOrgId, targetUserId } = await seedAdminAndTargetUser();
    const bearer = { authorization: `Bearer ${token}` } as const;

    const compRecord = await BusinessRecord.create({
      orgId: tenantOrgId, area: "enterprise", module: "ent-comp", code: "COMP-0002",
      title: "Base salary", status: "Active", owner: null, data: { amount: "3000000" },
    });
    const minwageRecord = await BusinessRecord.create({
      orgId: tenantOrgId, area: "enterprise", module: "ent-minwage", code: "MW-0002",
      title: "DKI Jakarta 2026", status: "Active", owner: null, data: { amount: "4900000" },
    });

    const bound = await request(app).put(`/v1/users/${targetUserId}/compensation`).set(bearer).send({
      compRecordId: compRecord.id,
      minwageRecordId: minwageRecord.id,
    });
    expect(bound.status).toBe(200);
    expect(bound.body.data.minwageCompliant).toBe(false);
  });

  it("rejects a compensation binding to a record from another organization", async () => {
    const { token, targetUserId } = await seedAdminAndTargetUser();
    const other = await Organization.create({
      name: "Other", code: "OTHR", type: "Tenant", status: "Active",
      parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null,
    });
    const foreignComp = await BusinessRecord.create({
      orgId: other.id, area: "enterprise", module: "ent-comp", code: "COMP-0099",
      title: "Foreign", status: "Active", owner: null, data: {},
    });
    const res = await request(app).put(`/v1/users/${targetUserId}/compensation`).set("authorization", `Bearer ${token}`).send({
      compRecordId: foreignComp.id,
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("COMP_RECORD_NOT_FOUND");
  });

  it("creates a personnel profile via the Add Profile flow", async () => {
    const { token, tenantOrgId } = await seedAdminAndTargetUser();
    const res = await request(app).post("/v1/personnel-profiles").set("authorization", `Bearer ${token}`).send({
      orgId: tenantOrgId,
      fullName: "New Hire",
      username: "newhire1",
      email: "newhire1@acme.com",
      personnelType: "Employee",
      empLevel: "Staff",
    });
    expect(res.status).toBe(201);
    expect(res.body.data.fullName).toBe("New Hire");
    expect(res.body.data.personnelType).toBe("Employee");
    expect(res.body.data.status).toBe("Pending Activation");
  });

  it("forbids a Distributor actor from reading/managing personnel records on an out-of-scope user", async () => {
    const { token, outOfScopeUserId } = await seedDistributorActor();
    const bearer = { authorization: `Bearer ${token}` } as const;

    const list = await request(app).get(`/v1/users/${outOfScopeUserId}/contract-documents`).set(bearer);
    expect(list.status).toBe(403);

    const create = await request(app).post(`/v1/users/${outOfScopeUserId}/activity`).set(bearer).send({ action: "note.added" });
    expect(create.status).toBe(403);
  });
});
