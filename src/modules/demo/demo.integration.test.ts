import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import { initModels, Organization, User, Role, DemoTenant } from "../../db/models";
import { hashPassword } from "../../lib/password";
import { resetDb, grantActions, seedActionCatalog } from "../../../test/helpers";
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

describe("demo access — real login (N8)", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("generate provisions a real Tenant org+user that can sign in with the issued username/tempPassword", async () => {
    const sp = await actor("ServiceOwner", "AXIA", "soadmin", ALL);
    const created = await request(app).post("/v1/demo-tenants").set(authed(sp.token)).send(NEW);
    const { id, username, tempPassword } = created.body.data;
    await request(app).post(`/v1/demo-tenants/${id}/generate`).set(authed(sp.token));

    const login = await request(app).post("/v1/auth/login").send({ identifier: username, password: tempPassword });
    expect(login.status).toBe(200);
    expect(login.body.data.user.orgType).toBe("Tenant");
    expect(login.body.data.user.orgName).toBe(NEW.org);
    expect(login.body.data.user.roles).toContain("Demo Tenant Admin");
    expect(login.body.data.demoSession).toMatchObject({ org: NEW.org, role: "Demo Tenant Admin", modules: ["Framework Management"] });
    expect(login.body.data.demoSession.expiresAt).toBeTruthy();
  });

  it("a regular (non-demo) login never carries a demoSession", async () => {
    const sp = await actor("ServiceOwner", "AXIA", "soadmin", ALL);
    const login = await request(app).post("/v1/auth/login").send({ identifier: "soadmin", password: "ChangeMe123" });
    expect(login.status).toBe(200);
    expect(login.body.data.demoSession).toBeUndefined();
    expect(sp.token).toBeTruthy(); // sanity: actor() itself already logged in once above
  });

  it("disabling a generated workspace blocks its real login (via the suspended User row, defense-in-depth)", async () => {
    const sp = await actor("ServiceOwner", "AXIA", "soadmin", ALL);
    const created = await request(app).post("/v1/demo-tenants").set(authed(sp.token)).send(NEW);
    const { id, username, tempPassword } = created.body.data;
    await request(app).post(`/v1/demo-tenants/${id}/generate`).set(authed(sp.token));
    await request(app).post(`/v1/demo-tenants/${id}/disable`).set(authed(sp.token));

    const login = await request(app).post("/v1/auth/login").send({ identifier: username, password: tempPassword });
    expect(login.status).toBe(401);
    expect(login.body.error.code).toBe("AUTH_FAILED");
  });

  it("an expired generated workspace blocks its real login even though the User row is still Active", async () => {
    const sp = await actor("ServiceOwner", "AXIA", "soadmin", ALL);
    const created = await request(app).post("/v1/demo-tenants").set(authed(sp.token)).send(NEW);
    const { id, username, tempPassword } = created.body.data;
    await request(app).post(`/v1/demo-tenants/${id}/generate`).set(authed(sp.token));

    const d = await DemoTenant.findByPk(id);
    d!.expiresAt = new Date(Date.now() - 1000);
    await d!.save();

    // Same generic AUTH_FAILED as any other rejected login — a distinct code
    // here would let a caller confirm a guessed password was cryptographically
    // correct, just temporarily blocked. Internal visibility (metadata.reason
    // = "demo_expired") still lands in the audit log, just not the response.
    const login = await request(app).post("/v1/auth/login").send({ identifier: username, password: tempPassword });
    expect(login.status).toBe(401);
    expect(login.body.error.code).toBe("AUTH_FAILED");
  });

  it("refresh() also dies once a demo workspace expires, even for a token minted while it was active", async () => {
    const sp = await actor("ServiceOwner", "AXIA", "soadmin", ALL);
    const created = await request(app).post("/v1/demo-tenants").set(authed(sp.token)).send(NEW);
    const { id, username, tempPassword } = created.body.data;
    await request(app).post(`/v1/demo-tenants/${id}/generate`).set(authed(sp.token));

    const login = await request(app).post("/v1/auth/login").send({ identifier: username, password: tempPassword });
    const refreshToken = login.body.data.refreshToken;

    const d = await DemoTenant.findByPk(id);
    d!.expiresAt = new Date(Date.now() - 1000);
    await d!.save();

    const refreshed = await request(app).post("/v1/auth/refresh").send({ refreshToken });
    expect(refreshed.status).toBe(401);
    expect(refreshed.body.error.code).toBe("DEMO_EXPIRED");
  });

  it("disabling revokes an already-issued refresh token, not just future logins", async () => {
    const sp = await actor("ServiceOwner", "AXIA", "soadmin", ALL);
    const created = await request(app).post("/v1/demo-tenants").set(authed(sp.token)).send(NEW);
    const { id, username, tempPassword } = created.body.data;
    await request(app).post(`/v1/demo-tenants/${id}/generate`).set(authed(sp.token));

    const login = await request(app).post("/v1/auth/login").send({ identifier: username, password: tempPassword });
    const refreshToken = login.body.data.refreshToken;

    await request(app).post(`/v1/demo-tenants/${id}/disable`).set(authed(sp.token));

    const refreshed = await request(app).post("/v1/auth/refresh").send({ refreshToken });
    expect(refreshed.status).toBe(401);
  });

  it("rejecting an already-generated workspace revokes its live session too", async () => {
    const sp = await actor("ServiceOwner", "AXIA", "soadmin", ALL);
    const created = await request(app).post("/v1/demo-tenants").set(authed(sp.token)).send(NEW);
    const { id, username, tempPassword } = created.body.data;
    await request(app).post(`/v1/demo-tenants/${id}/generate`).set(authed(sp.token));
    const login = await request(app).post("/v1/auth/login").send({ identifier: username, password: tempPassword });
    const refreshToken = login.body.data.refreshToken;

    await request(app).post(`/v1/demo-tenants/${id}/reject`).set(authed(sp.token));

    expect((await request(app).post("/v1/auth/login").send({ identifier: username, password: tempPassword })).status).toBe(401);
    expect((await request(app).post("/v1/auth/refresh").send({ refreshToken })).status).toBe(401);
  });

  it("resend rotates the temp password and invalidates the previous one", async () => {
    const sp = await actor("ServiceOwner", "AXIA", "soadmin", ALL);
    const created = await request(app).post("/v1/demo-tenants").set(authed(sp.token)).send(NEW);
    const { id, username, tempPassword: oldPassword } = created.body.data;
    await request(app).post(`/v1/demo-tenants/${id}/generate`).set(authed(sp.token));

    const resent = await request(app).post(`/v1/demo-tenants/${id}/resend`).set(authed(sp.token));
    const newPassword = resent.body.data.tempPassword;
    expect(newPassword).not.toBe(oldPassword);

    expect((await request(app).post("/v1/auth/login").send({ identifier: username, password: oldPassword })).status).toBe(401);
    expect((await request(app).post("/v1/auth/login").send({ identifier: username, password: newPassword })).status).toBe(200);
  });

  it("re-extending a disabled workspace restores real login", async () => {
    const sp = await actor("ServiceOwner", "AXIA", "soadmin", ALL);
    const created = await request(app).post("/v1/demo-tenants").set(authed(sp.token)).send(NEW);
    const { id, username, tempPassword } = created.body.data;
    await request(app).post(`/v1/demo-tenants/${id}/generate`).set(authed(sp.token));
    await request(app).post(`/v1/demo-tenants/${id}/disable`).set(authed(sp.token));
    await request(app).post(`/v1/demo-tenants/${id}/extend`).set(authed(sp.token)).send({ validityHours: 24 });

    const login = await request(app).post("/v1/auth/login").send({ identifier: username, password: tempPassword });
    expect(login.status).toBe(200);
    expect(login.body.data.demoSession).toBeTruthy();
  });

  it("re-generating an already-provisioned workspace reuses the same org (idempotent)", async () => {
    const sp = await actor("ServiceOwner", "AXIA", "soadmin", ALL);
    const created = await request(app).post("/v1/demo-tenants").set(authed(sp.token)).send(NEW);
    const { id, username, tempPassword } = created.body.data;
    await request(app).post(`/v1/demo-tenants/${id}/generate`).set(authed(sp.token));
    const firstLogin = await request(app).post("/v1/auth/login").send({ identifier: username, password: tempPassword });
    const firstOrgId = firstLogin.body.data.user.orgId;

    await request(app).post(`/v1/demo-tenants/${id}/generate`).set(authed(sp.token));
    const secondLogin = await request(app).post("/v1/auth/login").send({ identifier: username, password: tempPassword });
    expect(secondLogin.body.data.user.orgId).toBe(firstOrgId);
  });

  // A demo that picked a lab module lands in the real LIMS screens, so it needs
  // data — OD's Demo Lab is pre-populated and an empty table defeats the demo.
  it("seeds LIMS services for a laboratory demo, and not for others", async () => {
    const sp = await actor("ServiceOwner", "AXIA", "soadmin", ALL);
    // The demo admin role is granted every catalogued action, so the catalog
    // has to exist (production seeds it before any demo is generated).
    await seedActionCatalog();

    const lab = await request(app).post("/v1/demo-tenants").set(authed(sp.token))
      .send({ ...NEW, org: "Lab Co", email: "lab@co.io", module: "Testing Services" });
    await request(app).post(`/v1/demo-tenants/${lab.body.data.id}/generate`).set(authed(sp.token));
    const labLogin = await request(app).post("/v1/auth/login")
      .send({ identifier: lab.body.data.username, password: lab.body.data.tempPassword });
    const labServices = await request(app).get("/v1/lims/testing-services")
      .set({ Authorization: `Bearer ${labLogin.body.data.accessToken}` });
    expect(labServices.status).toBe(200);
    expect(labServices.body.data.length).toBeGreaterThan(0);

    // A framework-only demo gets no lab data.
    const fw = await request(app).post("/v1/demo-tenants").set(authed(sp.token)).send(NEW);
    await request(app).post(`/v1/demo-tenants/${fw.body.data.id}/generate`).set(authed(sp.token));
    const fwLogin = await request(app).post("/v1/auth/login")
      .send({ identifier: fw.body.data.username, password: fw.body.data.tempPassword });
    const fwServices = await request(app).get("/v1/lims/testing-services")
      .set({ Authorization: `Bearer ${fwLogin.body.data.accessToken}` });
    expect(fwServices.body.data).toHaveLength(0);
  });

  // OD's `#demo=<id>` deep link signs the visitor straight in. The demo id is a
  // v4 UUID, so possession of the link is the credential — but the demo window
  // is still enforced.
  it("signs a visitor in from the demo link and carries the demo session", async () => {
    const sp = await actor("ServiceOwner", "AXIA", "soadmin", ALL);
    const created = await request(app).post("/v1/demo-tenants").set(authed(sp.token)).send(NEW);
    const { id } = created.body.data;
    await request(app).post(`/v1/demo-tenants/${id}/generate`).set(authed(sp.token));

    const res = await request(app).post("/v1/auth/demo-link").send({ demoId: id });
    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeTruthy();
    expect(res.body.data.user.orgType).toBe("Tenant");
    expect(res.body.data.demoSession).toMatchObject({ org: NEW.org, role: "Demo Tenant Admin" });
  });

  it("refuses the demo link before the workspace is generated, once disabled, and once expired", async () => {
    const sp = await actor("ServiceOwner", "AXIA", "soadmin", ALL);
    const created = await request(app).post("/v1/demo-tenants").set(authed(sp.token)).send(NEW);
    const { id } = created.body.data;

    // Not yet provisioned.
    const early = await request(app).post("/v1/auth/demo-link").send({ demoId: id });
    expect(early.status).toBe(401);
    expect(early.body.error.code).toBe("DEMO_LINK_INVALID");

    await request(app).post(`/v1/demo-tenants/${id}/generate`).set(authed(sp.token));
    expect((await request(app).post("/v1/auth/demo-link").send({ demoId: id })).status).toBe(200);

    // Expired.
    const d = await DemoTenant.findByPk(id);
    d!.expiresAt = new Date(Date.now() - 1000);
    await d!.save();
    const expired = await request(app).post("/v1/auth/demo-link").send({ demoId: id });
    expect(expired.status).toBe(401);
    expect(expired.body.error.code).toBe("DEMO_LINK_INVALID");
  });

  it("gives the same answer for an unknown id as for an expired one, so ids cannot be probed", async () => {
    const unknown = await request(app).post("/v1/auth/demo-link").send({ demoId: "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0" });
    expect(unknown.status).toBe(401);
    expect(unknown.body.error.code).toBe("DEMO_LINK_INVALID");

    const malformed = await request(app).post("/v1/auth/demo-link").send({ demoId: "not-a-uuid" });
    expect(malformed.status).toBe(401);
    expect(malformed.body.error.code).toBe("DEMO_LINK_INVALID");
  });
});
