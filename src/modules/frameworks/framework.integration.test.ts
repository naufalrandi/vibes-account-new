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

async function tenantWithGrants(): Promise<string> {
  const tenant = await Organization.create({
    name: "Acme", code: "ACME", type: "Tenant", status: "Active",
    parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null,
  });
  const user = await User.create({
    orgId: tenant.id, tenantId: tenant.id, fullName: "T", username: "tuser", email: "t@acme.io",
    passwordHash: await hashPassword("ChangeMe123"), status: "Active",
    position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null,
  });
  const role = await Role.create({ name: "Tenant Admin", tierScope: "Tenant", orgId: tenant.id, isSuperAdmin: false, status: true });
  await (user as unknown as { setRoles: (roles: Role[]) => Promise<unknown> }).setRoles([role]);
  await grantActions(role.id, [ACTIONS.FRAMEWORK_READ, ACTIONS.FRAMEWORK_CREATE]);
  const login = await request(app).post("/v1/auth/login").send({ identifier: "tuser", password: "ChangeMe123" });
  return login.body.data.accessToken;
}

async function groupId(token: string, name: string): Promise<string> {
  const groups = await request(app).get("/v1/framework-groups").set(bearer(token));
  const match = (groups.body.data as { id: string; name: string }[]).find((g) => g.name === name);
  return match!.id;
}

describe("frameworks (group-based library)", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("requires authentication", async () => {
    expect((await request(app).get("/v1/frameworks")).status).toBe(401);
    expect((await request(app).get("/v1/framework-groups")).status).toBe(401);
  });

  it("forbids a non-Service-Owner even with grants", async () => {
    const token = await tenantWithGrants();
    expect((await request(app).get("/v1/frameworks").set(bearer(token))).status).toBe(403);
    expect((await request(app).get("/v1/framework-groups").set(bearer(token))).status).toBe(403);
  });

  it("seeds the two fixed framework groups", async () => {
    const token = await soLogin();
    const res = await request(app).get("/v1/framework-groups").set(bearer(token));
    expect(res.status).toBe(200);
    expect((res.body.data as { name: string }[]).map((g) => g.name)).toEqual(["Standards", "Regulations"]);
  });

  it("creates a framework under a group with jurisdictions and lists it", async () => {
    const token = await soLogin();
    const standards = await groupId(token, "Standards");
    const res = await request(app).post("/v1/frameworks").set(bearer(token)).send({
      groupId: standards,
      name: "ISO/IEC 27001:2022",
      description: "Information security management.",
      jurisdictions: ["Global"],
      status: "Active",
    });
    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe("ISO/IEC 27001:2022");
    expect(res.body.data.groupName).toBe("Standards");
    expect(res.body.data.jurisdictions).toEqual(["Global"]);
    expect(res.body.data.requirementCount).toBe(0);

    const list = await request(app).get("/v1/frameworks").set(bearer(token));
    expect(list.body.data).toHaveLength(1);

    const filtered = await request(app).get(`/v1/frameworks?groupId=${standards}`).set(bearer(token));
    expect(filtered.body.data).toHaveLength(1);
  });

  it("rejects a framework with an unknown group", async () => {
    const token = await soLogin();
    const res = await request(app).post("/v1/frameworks").set(bearer(token))
      .send({ groupId: "00000000-0000-0000-0000-000000000000", name: "Orphan" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("GROUP_NOT_FOUND");
  });

  it("updates a framework: rename, restatus, and move group", async () => {
    const token = await soLogin();
    const standards = await groupId(token, "Standards");
    const regulations = await groupId(token, "Regulations");
    const created = await request(app).post("/v1/frameworks").set(bearer(token))
      .send({ groupId: standards, name: "GDPR" });

    const res = await request(app).put(`/v1/frameworks/${created.body.data.id}`).set(bearer(token))
      .send({ name: "GDPR 2016/679", status: "Archived", groupId: regulations });
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe("GDPR 2016/679");
    expect(res.body.data.status).toBe("Archived");
    expect(res.body.data.groupName).toBe("Regulations");
  });

  it("deletes a framework", async () => {
    const token = await soLogin();
    const standards = await groupId(token, "Standards");
    const created = await request(app).post("/v1/frameworks").set(bearer(token))
      .send({ groupId: standards, name: "Temp" });
    const del = await request(app).delete(`/v1/frameworks/${created.body.data.id}`).set(bearer(token));
    expect(del.status).toBe(200);
    const get = await request(app).get(`/v1/frameworks/${created.body.data.id}`).set(bearer(token));
    expect(get.status).toBe(404);
  });
});
