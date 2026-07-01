import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import { initModels, Organization, User, Role, DemoTenant } from "../../db/models";
import { hashPassword } from "../../lib/password";
import { resetDb, grantActions } from "../../../test/helpers";
import { ACTIONS } from "../iam/actions.catalog";

const app = createApp();
const authed = (t: string) => ({ Authorization: `Bearer ${t}` });
const ALL = [ACTIONS.DEMO_READ, ACTIONS.DEMO_CREATE, ACTIONS.DEMO_MANAGE];

async function actor(orgType: "ServiceOwner" | "Tenant", code: string, username: string, actions: string[]) {
  const org = await Organization.create({ name: code, code, type: orgType, status: "Active", parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null });
  if (orgType === "Tenant") { org.tenantId = org.id; await org.save(); }
  const user = await User.create({ orgId: org.id, tenantId: orgType === "Tenant" ? org.id : null, fullName: `${code} User`, username, email: `${username}@x.io`, passwordHash: await hashPassword("ChangeMe123"), status: "Active", position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null });
  const role = await Role.create({ name: `${code} R`, tierScope: orgType, orgId: org.id, isSuperAdmin: false, status: true });
  await (user as unknown as { setRoles: (r: Role[]) => Promise<unknown> }).setRoles([role]);
  await grantActions(role.id, actions);
  const login = await request(app).post("/v1/auth/login").send({ identifier: username, password: "ChangeMe123" });
  return { org, token: login.body.data.accessToken };
}

const NEW = { org: "PT Contoh", name: "Budi", email: "budi@contoh.co", module: "Framework Management", intendedUse: "Evaluate compliance modules" };

describe("demo access", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("requires demo.read and is Service-Provider only", async () => {
    const noAccess = await actor("ServiceOwner", "SP", "sp.noaccess", []);
    expect((await request(app).get("/v1/demo-tenants").set(authed(noAccess.token))).status).toBe(403);
    // A tenant, even granted the actions, is forbidden (SP-only control).
    const tenant = await actor("Tenant", "T", "t.user", ALL);
    expect((await request(app).get("/v1/demo-tenants").set(authed(tenant.token))).status).toBe(403);
  });

  it("creates a Pending request with issued identity and default validity", async () => {
    const sp = await actor("ServiceOwner", "AXIA", "soadmin", ALL);
    const res = await request(app).post("/v1/demo-tenants").set(authed(sp.token)).send(NEW);
    expect(res.status).toBe(201);
    expect(res.body.data.code).toMatch(/^DMO-\d{4}$/);
    expect(res.body.data.approval).toBe("Pending");
    expect(res.body.data.seedStatus).toBe("Pending");
    expect(res.body.data.accessStatus).toBeNull();
    expect(res.body.data.validityHours).toBe(48);
    expect(res.body.data.tenantId).toMatch(/^DEMO-/);
    expect(res.body.data.username).toBeTruthy();
    expect(res.body.data.tempPassword).toBeTruthy();
    expect(res.body.data.modules).toEqual(["Framework Management"]);
  });

  it("runs the full lifecycle: approve → generate → extend → disable → delete", async () => {
    const sp = await actor("ServiceOwner", "AXIA", "soadmin", ALL);
    const created = await request(app).post("/v1/demo-tenants").set(authed(sp.token)).send(NEW);
    const id = created.body.data.id;

    const approved = await request(app).post(`/v1/demo-tenants/${id}/approve`).set(authed(sp.token));
    expect(approved.body.data.approval).toBe("Approved");

    const generated = await request(app).post(`/v1/demo-tenants/${id}/generate`).set(authed(sp.token));
    expect(generated.body.data.seedStatus).toBe("Seeded");
    expect(generated.body.data.accessStatus).toBe("Active");
    expect(generated.body.data.expiresAt).toBeTruthy();

    const resent = await request(app).post(`/v1/demo-tenants/${id}/resend`).set(authed(sp.token));
    expect(resent.status).toBe(200);

    const extended = await request(app).post(`/v1/demo-tenants/${id}/extend`).set(authed(sp.token)).send({ validityHours: 72 });
    expect(extended.body.data.validityHours).toBe(72);

    const disabled = await request(app).post(`/v1/demo-tenants/${id}/disable`).set(authed(sp.token));
    expect(disabled.body.data.accessStatus).toBe("Disabled");

    // Extending a disabled workspace re-activates it.
    const reactivated = await request(app).post(`/v1/demo-tenants/${id}/extend`).set(authed(sp.token)).send({ validityHours: 24 });
    expect(reactivated.body.data.accessStatus).toBe("Active");

    const deleted = await request(app).post(`/v1/demo-tenants/${id}/delete`).set(authed(sp.token));
    expect(deleted.body.data.accessStatus).toBe("Deleted");
    expect(deleted.body.data.deletedAt).toBeTruthy();

    // A deleted workspace cannot be regenerated.
    expect((await request(app).post(`/v1/demo-tenants/${id}/generate`).set(authed(sp.token))).status).toBe(400);
  });

  it("rejecting disables access", async () => {
    const sp = await actor("ServiceOwner", "AXIA", "soadmin", ALL);
    const created = await request(app).post("/v1/demo-tenants").set(authed(sp.token)).send(NEW);
    const res = await request(app).post(`/v1/demo-tenants/${created.body.data.id}/reject`).set(authed(sp.token));
    expect(res.body.data.approval).toBe("Rejected");
    expect(res.body.data.accessStatus).toBe("Disabled");
  });

  it("auto-expires an active workspace whose expiry has passed", async () => {
    const sp = await actor("ServiceOwner", "AXIA", "soadmin", ALL);
    // Seed an already-active workspace that expired an hour ago.
    const d = await DemoTenant.create({
      code: "DMO-9001", org: "Late Co", name: "N", email: "n@late.co", title: null, country: null,
      module: "Framework Management", modules: ["Framework Management"], intendedUse: null,
      tenantId: "DEMO-9001", userId: "DU-9001", username: "late.demo", tempPassword: "temp1234abcd",
      role: "Demo Tenant Admin", approval: "Approved", accessStatus: "Active", seedStatus: "Seeded",
      validityHours: 1, expiresAt: new Date(Date.now() - 3600 * 1000), lastLogin: null, deletedAt: null,
    });
    const list = await request(app).get("/v1/demo-tenants").set(authed(sp.token));
    const row = list.body.data.find((r: { id: string }) => r.id === d.id);
    expect(row.accessStatus).toBe("Expired");
  });

  it("filters by approval status", async () => {
    const sp = await actor("ServiceOwner", "AXIA", "soadmin", ALL);
    const a = await request(app).post("/v1/demo-tenants").set(authed(sp.token)).send(NEW);
    await request(app).post("/v1/demo-tenants").set(authed(sp.token)).send({ ...NEW, org: "PT Dua" });
    await request(app).post(`/v1/demo-tenants/${a.body.data.id}/approve`).set(authed(sp.token));
    const res = await request(app).get("/v1/demo-tenants?approval=Approved").set(authed(sp.token));
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].approval).toBe("Approved");
  });
});
