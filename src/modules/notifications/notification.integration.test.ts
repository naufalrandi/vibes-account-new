import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import { initModels, Notification, Organization, User, Role } from "../../db/models";
import { hashPassword } from "../../lib/password";
import { resetDb } from "../../../test/helpers";

const app = createApp();
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
const setRoles = (u: User, roles: Role[]) =>
  (u as unknown as { setRoles: (r: Role[]) => Promise<unknown> }).setRoles(roles);

async function login(orgType: "ServiceOwner" | "Tenant", code: string, username: string) {
  const org = await Organization.create({
    name: code, code, type: orgType, status: "Active",
    parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null,
  });
  if (orgType === "Tenant") await org.update({ tenantId: org.id });
  const u = await User.create({
    orgId: org.id, tenantId: orgType === "Tenant" ? org.id : null, fullName: "U", username, email: `${username}@x.io`,
    passwordHash: await hashPassword("ChangeMe123"), status: "Active",
    position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null,
  });
  const role = await Role.create({ name: "Admin", tierScope: orgType, orgId: org.id, isSuperAdmin: orgType === "ServiceOwner", status: true });
  await setRoles(u, [role]);
  const res = await request(app).post("/v1/auth/login").send({ identifier: username, password: "ChangeMe123" });
  return { token: res.body.data.accessToken, orgId: org.id };
}

describe("notifications (bell)", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("requires authentication", async () => {
    const res = await request(app).get("/v1/notifications");
    expect(res.status).toBe(401);
  });

  it("scopes notifications: SO sees all, a tenant sees only its own + platform-wide", async () => {
    const so = await login("ServiceOwner", "AXIA", "soadmin");
    const tenant = await login("Tenant", "ACME", "tadmin");
    await Notification.create({ orgId: null, text: "Platform-wide notice", read: false });
    await Notification.create({ orgId: tenant.orgId, text: "Tenant notice", read: false });
    await Notification.create({ orgId: so.orgId, text: "SO-only notice", read: false });

    const tList = await request(app).get("/v1/notifications").set(bearer(tenant.token));
    expect(tList.status).toBe(200);
    const tTexts = tList.body.data.map((n: { text: string }) => n.text);
    expect(tTexts).toContain("Platform-wide notice");
    expect(tTexts).toContain("Tenant notice");
    expect(tTexts).not.toContain("SO-only notice");

    const soList = await request(app).get("/v1/notifications").set(bearer(so.token));
    expect(soList.body.data.length).toBe(3);
  });

  it("marks all visible notifications read", async () => {
    const tenant = await login("Tenant", "ACME", "tadmin");
    await Notification.create({ orgId: tenant.orgId, text: "Unread one", read: false });
    await Notification.create({ orgId: tenant.orgId, text: "Unread two", read: false });

    const res = await request(app).post("/v1/notifications/read").set(bearer(tenant.token));
    expect(res.status).toBe(200);
    expect(res.body.data.updated).toBe(2);

    const after = await request(app).get("/v1/notifications").set(bearer(tenant.token));
    expect(after.body.data.every((n: { read: boolean }) => n.read)).toBe(true);
  });
});
