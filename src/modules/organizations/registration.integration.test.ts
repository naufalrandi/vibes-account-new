import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import { initModels, Organization, User, Role, RegistrationRequest } from "../../db/models";
import { hashPassword } from "../../lib/password";
import { resetDb, grantActions } from "../../../test/helpers";

const app = createApp();

async function makeAdmin(orgType: "ServiceOwner" | "Distributor", code: string, username: string, actionKeys: string[], parentOrgId: string | null = null) {
  const org = await Organization.create({
    name: code, code, type: orgType, status: "Active",
    parentOrgId, tenantId: null, email: null, phone: null, website: null, country: null, address: null,
  });
  const admin = await User.create({
    orgId: org.id, tenantId: null, fullName: `${code} admin`, username, email: `${username}@x.com`,
    passwordHash: await hashPassword("ChangeMe123"), status: "Active",
    position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null,
  });
  // Non-super-admin role granted exactly the given action keys (so we can test denials).
  const role = await Role.create({ name: `${code} Admin`, tierScope: orgType, orgId: org.id, isSuperAdmin: false, status: true });
  // belongsToMany generates a `setRoles` mixin at runtime; `.set("Roles", ...)` is the
  // generic attribute setter and does NOT persist the association (matches user tests).
  await (admin as unknown as { setRoles: (roles: Role[]) => Promise<unknown> }).setRoles([role]);
  await grantActions(role.id, actionKeys);
  const login = await request(app).post("/v1/auth/login").send({ identifier: username, password: "ChangeMe123" });
  return { org, token: login.body.data.accessToken };
}

describe("registration workflow", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("distributor submits, SO approves → tenant + admin provisioned", async () => {
    const dist = await makeAdmin("Distributor", "NWP", "distadmin", ["registration.submit"]);
    const so = await makeAdmin("ServiceOwner", "AXIA", "soadmin", ["registration.decide"]);

    const submit = await request(app).post("/v1/registration-requests").set("authorization", `Bearer ${dist.token}`)
      .send({ name: "Acme", code: "ACME", adminFullName: "Acme Admin", adminUsername: "acmeadmin", adminEmail: "admin@acme.com" });
    expect(submit.status).toBe(201);
    const reqId = submit.body.data.id;

    const approve = await request(app).post(`/v1/registration-requests/${reqId}/approve`).set("authorization", `Bearer ${so.token}`);
    expect(approve.status).toBe(201);
    expect(approve.body.data.type).toBe("Tenant");

    const tenant = await Organization.findOne({ where: { code: "ACME" } });
    expect(tenant?.parentOrgId).toBe(dist.org.id);
    const admin = await User.findOne({ where: { username: "acmeadmin" } });
    expect(admin?.status).toBe("PendingActivation");
    const req = await RegistrationRequest.findByPk(reqId);
    expect(req?.status).toBe("Approved");
  });

  it("distributor cannot approve (decide permission required)", async () => {
    const dist = await makeAdmin("Distributor", "NWP", "distadmin", ["registration.submit"]);
    const submit = await request(app).post("/v1/registration-requests").set("authorization", `Bearer ${dist.token}`)
      .send({ name: "Acme", code: "ACME", adminFullName: "A", adminUsername: "acmeadmin", adminEmail: "admin@acme.com" });
    const res = await request(app).post(`/v1/registration-requests/${submit.body.data.id}/approve`).set("authorization", `Bearer ${dist.token}`);
    expect(res.status).toBe(403);
  });
});
