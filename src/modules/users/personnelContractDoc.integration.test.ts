import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import { AuditLog, initModels, Organization, PersonnelCompensation, User, Role } from "../../db/models";
import { hashPassword } from "../../lib/password";
import { resetDb } from "../../../test/helpers";

const app = createApp();

async function setup(): Promise<{ bearer: { authorization: string }; tenantId: string; targetUserId: string }> {
  const tenant = await Organization.create({
    name: "Acme", code: "ACMECD", type: "Tenant", status: "Active",
    parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null,
  });
  tenant.tenantId = tenant.id;
  await tenant.save();
  const admin = await User.create({
    orgId: tenant.id, tenantId: tenant.id, fullName: "Admin", username: "cdadmin", email: "cdadmin@acme.com",
    passwordHash: await hashPassword("ChangeMe123"), status: "Active",
    position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null,
  });
  const role = await Role.create({ name: "Administrator", tierScope: "Tenant", orgId: tenant.id, isSuperAdmin: true, status: true });
  await (admin as unknown as { setRoles: (r: Role[]) => Promise<unknown> }).setRoles([role]);
  const target = await User.create({
    orgId: tenant.id, tenantId: tenant.id, fullName: "Target Person", username: "cdperson", email: "cdperson@acme.com",
    passwordHash: null, status: "Active", position: null, workUnit: null, lastLogin: null,
    activationToken: null, resetToken: null, resetExpires: null,
  });
  const login = await request(app).post("/v1/auth/login").send({ identifier: "cdadmin", password: "ChangeMe123" });
  return { bearer: { authorization: `Bearer ${login.body.data.accessToken}` }, tenantId: tenant.id, targetUserId: target.id };
}

describe("personnel contract document lifecycle and audit", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("enforces Draft → Issued → Signed and freezes a signed document", async () => {
    const { bearer, targetUserId } = await setup();
    const base = `/v1/users/${targetUserId}/contract-documents`;

    expect((await request(app).post(base).set(bearer).send({ title: "Contract", status: "Signed" })).status).toBe(400);
    const doc = (await request(app).post(base).set(bearer).send({ title: "Contract" })).body.data;

    // Status never moves through a plain edit, and a Draft cannot be signed.
    expect((await request(app).put(`${base}/${doc.id}`).set(bearer).send({ status: "Issued" })).status).toBe(409);
    expect((await request(app).post(`${base}/${doc.id}/sign`).set(bearer)).status).toBe(409);

    expect((await request(app).post(`${base}/${doc.id}/issue`).set(bearer)).body.data.status).toBe("Issued");
    const signed = await request(app).post(`${base}/${doc.id}/sign`).set(bearer);
    expect(signed.body.data).toMatchObject({ status: "Signed", signedBy: "Admin" });

    const edit = await request(app).put(`${base}/${doc.id}`).set(bearer).send({ clauses: [] });
    expect(edit.status).toBe(409);
    expect(edit.body.error.code).toBe("CONTRACT_DOC_SIGNED");
    expect((await request(app).post(`${base}/${doc.id}/issue`).set(bearer)).status).toBe(409);
  });

  it("audits personnel changes with the tenant, and reads compensation without creating it", async () => {
    const { bearer, tenantId, targetUserId } = await setup();
    const comp = await request(app).get(`/v1/users/${targetUserId}/compensation`).set(bearer);
    expect(comp.status).toBe(200);
    expect(comp.body.data.id).toBeNull();
    expect(await PersonnelCompensation.count({ where: { userId: targetUserId } })).toBe(0);

    await request(app).post(`/v1/users/${targetUserId}/contract-documents`).set(bearer).send({ title: "Contract" });
    const row = await AuditLog.findOne({ where: { action: "personnel.contract_document.created", entityId: targetUserId } });
    expect(row?.tenantId).toBe(tenantId);
  });
});
