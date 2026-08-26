import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import { initModels, Organization, User, Role } from "../../db/models";
import { hashPassword } from "../../lib/password";
import { resetDb, grantActions } from "../../../test/helpers";
import { ACTIONS } from "../iam/actions.catalog";

const app = createApp();

/** Tenant admin (super-admin role, bypasses requireAction) + a target user in the same tenant. */
async function seedAdminAndTargetUser(): Promise<{ token: string; tenantOrgId: string; targetUserId: string }> {
  const tenant = await Organization.create({
    name: "Acme", code: "ACME", type: "Tenant", status: "Active",
    parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null,
  });
  tenant.tenantId = tenant.id;
  await tenant.save();

  const admin = await User.create({
    orgId: tenant.id, tenantId: tenant.id, fullName: "Admin", username: "tadmin", email: "tadmin@acme.com",
    passwordHash: await hashPassword("ChangeMe123"), status: "Active",
    position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null,
  });
  const role = await Role.create({ name: "Administrator", tierScope: "Tenant", orgId: tenant.id, isSuperAdmin: true, status: true });
  await (admin as unknown as { setRoles: (r: Role[]) => Promise<unknown> }).setRoles([role]);

  const target = await User.create({
    orgId: tenant.id, tenantId: tenant.id, fullName: "Target Person", username: "tperson", email: "tperson@acme.com",
    passwordHash: null, status: "Active", position: null, workUnit: null, lastLogin: null,
    activationToken: null, resetToken: null, resetExpires: null,
  });

  const login = await request(app).post("/v1/auth/login").send({ identifier: "tadmin", password: "ChangeMe123" });
  return { token: login.body.data.accessToken, tenantOrgId: tenant.id, targetUserId: target.id };
}

/** A non-super Distributor admin (with personnel-record grants) plus an out-of-scope target user in a ServiceOwner org. */
async function seedDistributorActor(): Promise<{ token: string; outOfScopeUserId: string }> {
  const so = await Organization.create({
    name: "AXIA", code: "AXIA", type: "ServiceOwner", status: "Active",
    parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null,
  });
  const dist = await Organization.create({
    name: "Northwind", code: "NWP", type: "Distributor", status: "Active",
    parentOrgId: so.id, tenantId: null, email: null, phone: null, website: null, country: null, address: null,
  });
  const soUser = await User.create({
    orgId: so.id, tenantId: null, fullName: "SO Person", username: "soperson2", email: "soperson2@axia.io",
    passwordHash: null, status: "Active", position: null, workUnit: null, lastLogin: null,
    activationToken: null, resetToken: null, resetExpires: null,
  });
  const distAdmin = await User.create({
    orgId: dist.id, tenantId: null, fullName: "Dist Admin", username: "distadmin2", email: "da2@nwp.io",
    passwordHash: await hashPassword("ChangeMe123"), status: "Active", position: null, workUnit: null,
    lastLogin: null, activationToken: null, resetToken: null, resetExpires: null,
  });
  const role = await Role.create({ name: "Administrator", tierScope: "Distributor", orgId: dist.id, isSuperAdmin: false, status: true });
  await (distAdmin as unknown as { setRoles: (r: Role[]) => Promise<unknown> }).setRoles([role]);
  await grantActions(role.id, [
    ACTIONS.PERSONNEL_RESUME_READ, ACTIONS.PERSONNEL_RESUME_CREATE, ACTIONS.PERSONNEL_RESUME_DELETE,
    ACTIONS.PERSONNEL_LEAVE_READ, ACTIONS.PERSONNEL_LEAVE_CREATE, ACTIONS.PERSONNEL_LEAVE_DELETE,
    ACTIONS.PERSONNEL_DISCIPLINARY_READ, ACTIONS.PERSONNEL_DISCIPLINARY_CREATE, ACTIONS.PERSONNEL_DISCIPLINARY_DELETE,
    ACTIONS.PERSONNEL_PERFORMANCE_READ, ACTIONS.PERSONNEL_PERFORMANCE_CREATE, ACTIONS.PERSONNEL_PERFORMANCE_DELETE,
  ]);
  const login = await request(app).post("/v1/auth/login").send({ identifier: "distadmin2", password: "ChangeMe123" });
  return { token: login.body.data.accessToken, outOfScopeUserId: soUser.id };
}

describe("personnel records", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("creates, lists and deletes a resume record", async () => {
    const { token, targetUserId } = await seedAdminAndTargetUser();
    const bearer = { authorization: `Bearer ${token}` } as const;

    const created = await request(app).post(`/v1/users/${targetUserId}/resume-records`).set(bearer).send({
      recordType: "Education",
      title: "BSc Computer Science",
      organization: "State University",
      startDate: "2016-09-01",
      endDate: "2020-06-30",
    });
    expect(created.status).toBe(201);
    expect(created.body.data.recordType).toBe("Education");
    expect(created.body.data.userId).toBe(targetUserId);

    const list = await request(app).get(`/v1/users/${targetUserId}/resume-records`).set(bearer);
    expect(list.status).toBe(200);
    expect(list.body.data.length).toBe(1);

    const del = await request(app).delete(`/v1/users/${targetUserId}/resume-records/${created.body.data.id}`).set(bearer);
    expect(del.status).toBe(200);
    expect(del.body.data.removed).toBe(true);

    const after = await request(app).get(`/v1/users/${targetUserId}/resume-records`).set(bearer);
    expect(after.body.data.length).toBe(0);
  });

  it("rejects an invalid resume record_type", async () => {
    const { token, targetUserId } = await seedAdminAndTargetUser();
    const res = await request(app).post(`/v1/users/${targetUserId}/resume-records`).set("authorization", `Bearer ${token}`)
      .send({ recordType: "Hobby", title: "Chess" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_RECORD_TYPE");
  });

  it("creates a leave record and computes inclusive calendar days", async () => {
    const { token, targetUserId } = await seedAdminAndTargetUser();
    const bearer = { authorization: `Bearer ${token}` } as const;

    const created = await request(app).post(`/v1/users/${targetUserId}/leave-records`).set(bearer).send({
      leaveType: "Annual",
      fromDate: "2026-08-10",
      toDate: "2026-08-14",
    });
    expect(created.status).toBe(201);
    // Inclusive calendar days: Aug 10-14 = 5 days.
    expect(created.body.data.days).toBe(5);

    const list = await request(app).get(`/v1/users/${targetUserId}/leave-records`).set(bearer);
    expect(list.body.data.length).toBe(1);

    const del = await request(app).delete(`/v1/users/${targetUserId}/leave-records/${created.body.data.id}`).set(bearer);
    expect(del.status).toBe(200);
  });

  it("creates, lists and deletes a disciplinary record", async () => {
    const { token, targetUserId } = await seedAdminAndTargetUser();
    const bearer = { authorization: `Bearer ${token}` } as const;

    const created = await request(app).post(`/v1/users/${targetUserId}/disciplinary-records`).set(bearer).send({
      disciplineType: "Verbal Warning",
      incidentDate: "2026-07-01",
      description: "Late attendance",
    });
    expect(created.status).toBe(201);
    expect(created.body.data.status).toBe("Open");

    const list = await request(app).get(`/v1/users/${targetUserId}/disciplinary-records`).set(bearer);
    expect(list.body.data.length).toBe(1);

    const del = await request(app).delete(`/v1/users/${targetUserId}/disciplinary-records/${created.body.data.id}`).set(bearer);
    expect(del.status).toBe(200);
  });

  it("creates, lists and deletes a performance record", async () => {
    const { token, targetUserId } = await seedAdminAndTargetUser();
    const bearer = { authorization: `Bearer ${token}` } as const;

    const created = await request(app).post(`/v1/users/${targetUserId}/performance-records`).set(bearer).send({
      reviewPeriod: "2026 H1",
      rating: "Exceeds Expectations",
    });
    expect(created.status).toBe(201);

    const list = await request(app).get(`/v1/users/${targetUserId}/performance-records`).set(bearer);
    expect(list.body.data.length).toBe(1);

    const del = await request(app).delete(`/v1/users/${targetUserId}/performance-records/${created.body.data.id}`).set(bearer);
    expect(del.status).toBe(200);
  });

  it("forbids a Distributor actor from reading/creating personnel records on an out-of-scope user", async () => {
    const { token, outOfScopeUserId } = await seedDistributorActor();
    const bearer = { authorization: `Bearer ${token}` } as const;

    const list = await request(app).get(`/v1/users/${outOfScopeUserId}/resume-records`).set(bearer);
    expect(list.status).toBe(403);

    const create = await request(app).post(`/v1/users/${outOfScopeUserId}/leave-records`).set(bearer)
      .send({ leaveType: "Annual", fromDate: "2026-08-10", toDate: "2026-08-11" });
    expect(create.status).toBe(403);
  });
});
