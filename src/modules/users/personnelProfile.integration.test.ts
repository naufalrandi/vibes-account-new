import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import { initModels, Organization, User, Role } from "../../db/models";
import { hashPassword } from "../../lib/password";
import { resetDb } from "../../../test/helpers";

const app = createApp();

async function seedAdminAndLogin(): Promise<{ token: string; tenantOrgId: string; targetUserId: string }> {
  const so = await Organization.create({
    name: "AXIA", code: "AXIA", type: "ServiceOwner", status: "Active",
    parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null,
  });
  const tenant = await Organization.create({
    name: "Acme", code: "ACME", type: "Tenant", status: "Active",
    parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null,
  });
  tenant.tenantId = tenant.id;
  await tenant.save();

  const admin = await User.create({
    orgId: so.id, tenantId: null, fullName: "Admin", username: "soadmin", email: "soadmin@axia.io",
    passwordHash: await hashPassword("ChangeMe123"), status: "Active",
    position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null,
  });
  const role = await Role.create({ name: "SO Administrator", tierScope: "ServiceOwner", orgId: so.id, isSuperAdmin: true, status: true });
  await (admin as unknown as { setRoles: (roles: Role[]) => Promise<unknown> }).setRoles([role]);

  const target = await User.create({
    orgId: tenant.id, tenantId: tenant.id, fullName: "Employee One", username: "empone", email: "empone@acme.com",
    passwordHash: null, status: "Active", position: null, workUnit: null, lastLogin: null,
    activationToken: null, resetToken: null, resetExpires: null,
  });

  const login = await request(app).post("/v1/auth/login").send({ identifier: "soadmin", password: "ChangeMe123" });
  return { token: login.body.data.accessToken, tenantOrgId: tenant.id, targetUserId: target.id };
}

describe("personnel profile (personal / emergency / employment)", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("blocks unauthenticated access", async () => {
    const { targetUserId } = await seedAdminAndLogin();
    const res = await request(app).get(`/v1/users/${targetUserId}/personnel-profile`);
    expect(res.status).toBe(401);
  });

  it("returns an empty profile on first read (lazily created)", async () => {
    const { token, targetUserId } = await seedAdminAndLogin();
    const res = await request(app)
      .get(`/v1/users/${targetUserId}/personnel-profile`)
      .set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.userId).toBe(targetUserId);
    expect(res.body.data.dateOfBirth).toBeNull();
  });

  it("updates the Personal tab fields (personEditPersonal)", async () => {
    const { token, targetUserId } = await seedAdminAndLogin();
    const res = await request(app)
      .patch(`/v1/users/${targetUserId}/personnel-profile/personal`)
      .set("authorization", `Bearer ${token}`)
      .send({
        dateOfBirth: "1990-05-01", gender: "Female", maritalStatus: "Single", nationality: "Indonesian",
        idNumber: "3201xxxx", religion: "N/A", bloodType: "O", address: "Jl. Sudirman 1",
        country: "ID", state: "DKI Jakarta", city: "Jakarta", postalCode: "12345",
      });
    expect(res.status).toBe(200);
    expect(res.body.data.city).toBe("Jakarta");
    expect(res.body.data.postalCode).toBe("12345");
  });

  it("updates the Emergency Contact tab fields (personEditEmergency)", async () => {
    const { token, targetUserId } = await seedAdminAndLogin();
    const res = await request(app)
      .patch(`/v1/users/${targetUserId}/personnel-profile/emergency`)
      .set("authorization", `Bearer ${token}`)
      .send({ emergencyContactName: "Jane Doe", emergencyContactPhone: "+62-812-0000", emergencyContactRelationship: "Spouse" });
    expect(res.status).toBe(200);
    expect(res.body.data.emergencyContactName).toBe("Jane Doe");
    expect(res.body.data.emergencyContactRelationship).toBe("Spouse");
  });

  it("updates the Employment tab, writing shared fields onto User and the rest onto the profile", async () => {
    const { token, tenantOrgId, targetUserId } = await seedAdminAndLogin();
    const manager = await User.create({
      orgId: tenantOrgId, tenantId: tenantOrgId, fullName: "Manager One", username: "mgrone", email: "mgrone@acme.com",
      passwordHash: null, status: "Active", position: null, workUnit: null, lastLogin: null,
      activationToken: null, resetToken: null, resetExpires: null,
    });
    const res = await request(app)
      .patch(`/v1/users/${targetUserId}/personnel-profile/employment`)
      .set("authorization", `Bearer ${token}`)
      .send({
        personnelType: "Permanent Staff",
        employmentStatus: "Onboarding",
        managerId: manager.id,
        employeeId: "EMP-0001",
        contractType: "Fixed Duration",
        contractStartDate: "2026-01-01",
        contractEndDate: "2026-12-31",
        probationEndDate: "2026-04-01",
        contractDocumentRef: "CDOC-1",
        contractSigned: true,
      });
    expect(res.status).toBe(200);
    expect(res.body.data.employmentStatus).toBe("Onboarding");
    expect(res.body.data.managerId).toBe(manager.id);
    expect(res.body.data.contractSigned).toBe(true);

    const updatedUser = await User.findByPk(targetUserId);
    expect(updatedUser?.personnelType).toBe("Permanent Staff");
  });

  it("rejects a manager from another organization", async () => {
    const { token, targetUserId } = await seedAdminAndLogin();
    const other = await Organization.create({
      name: "Other", code: "OTH", type: "Tenant", status: "Active",
      parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null,
    });
    const outsider = await User.create({
      orgId: other.id, tenantId: other.id, fullName: "Outsider", username: "outsider", email: "outsider@other.com",
      passwordHash: null, status: "Active", position: null, workUnit: null, lastLogin: null,
      activationToken: null, resetToken: null, resetExpires: null,
    });
    const res = await request(app)
      .patch(`/v1/users/${targetUserId}/personnel-profile/employment`)
      .set("authorization", `Bearer ${token}`)
      .send({ managerId: outsider.id });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("MANAGER_NOT_FOUND");
  });

  it("renews a contract, moving the end date out and setting status Active", async () => {
    const { token, targetUserId } = await seedAdminAndLogin();
    await request(app)
      .patch(`/v1/users/${targetUserId}/personnel-profile/employment`)
      .set("authorization", `Bearer ${token}`)
      .send({ employmentStatus: "Onboarding", contractEndDate: "2026-06-30" });

    const rejected = await request(app)
      .post(`/v1/users/${targetUserId}/personnel-profile/employment/renew`)
      .set("authorization", `Bearer ${token}`)
      .send({ contractEndDate: "2026-01-01" });
    expect(rejected.status).toBe(400);
    expect(rejected.body.error.code).toBe("INVALID_RENEWAL_DATE");

    const res = await request(app)
      .post(`/v1/users/${targetUserId}/personnel-profile/employment/renew`)
      .set("authorization", `Bearer ${token}`)
      .send({ contractEndDate: "2027-06-30" });
    expect(res.status).toBe(200);
    expect(res.body.data.contractEndDate).toBe("2027-06-30");
    expect(res.body.data.employmentStatus).toBe("Active");
  });

  it("converts a contract to another OD contract type", async () => {
    const { token, targetUserId } = await seedAdminAndLogin();
    await request(app)
      .patch(`/v1/users/${targetUserId}/personnel-profile/employment`)
      .set("authorization", `Bearer ${token}`)
      .send({ contractType: "Fixed Duration" });

    const convertRes = await request(app)
      .post(`/v1/users/${targetUserId}/personnel-profile/employment/convert`)
      .set("authorization", `Bearer ${token}`)
      .send({ contractType: "Contractor (SOW)" });
    expect(convertRes.status).toBe(200);
    expect(convertRes.body.data.contractType).toBe("Contractor (SOW)");

    // No probation period on this contract, so there is nothing to confirm.
    const confirmRes = await request(app)
      .post(`/v1/users/${targetUserId}/personnel-profile/employment/confirm-probation`)
      .set("authorization", `Bearer ${token}`);
    expect(confirmRes.status).toBe(400);
    expect(confirmRes.body.error.code).toBe("NOT_ON_PROBATION");
  });

  // OD `CONTRACT_TYPE_SEED` (js/modules.js:5040-5044) has exactly four names;
  // "Fixed-Term", "Probation" and "Outsourced" are not contract types in OD.
  it("rejects contract-type names that are not in OD's seed", async () => {
    const { token, targetUserId } = await seedAdminAndLogin();
    for (const contractType of ["Fixed-Term", "Probation", "Outsourced"]) {
      const res = await request(app)
        .patch(`/v1/users/${targetUserId}/personnel-profile/employment`)
        .set("authorization", `Bearer ${token}`)
        .send({ contractType });
      expect(res.status).toBe(400);
    }
  });

  // Probation is a period inside a contract in OD (`contract.probationEnd`),
  // not a contract type — confirming it leaves the contract type alone.
  it("confirms probation from the probation end date, keeping the contract type", async () => {
    const { token, targetUserId } = await seedAdminAndLogin();
    await request(app)
      .patch(`/v1/users/${targetUserId}/personnel-profile/employment`)
      .set("authorization", `Bearer ${token}`)
      .send({ contractType: "Fixed Duration", probationEndDate: "2026-04-01", employmentStatus: "Onboarding" });

    const res = await request(app)
      .post(`/v1/users/${targetUserId}/personnel-profile/employment/confirm-probation`)
      .set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.contractType).toBe("Fixed Duration");
    expect(res.body.data.employmentStatus).toBe("Active");
  });
});
