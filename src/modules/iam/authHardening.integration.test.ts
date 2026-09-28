import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import type { InferCreationAttributes } from "sequelize";
import { createApp } from "../../app";
import { initModels, Organization, User, Role, RefreshToken, AuditLog } from "../../db/models";
import { hashPassword } from "../../lib/password";
import { hashToken } from "../../lib/tokens";
import { resetDb, lastMailedToken } from "../../../test/helpers";
import { resetRateLimits } from "../../middleware/rateLimit";
import { issueActivationToken } from "../notifications/notification.service";
import { ACTIONS } from "./actions.catalog";

const app = createApp();
const PW = "ChangeMe123";
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

async function makeOrg(type: "ServiceOwner" | "Distributor" | "Tenant", code: string): Promise<Organization> {
  const org = await Organization.create({
    name: code, code, type, status: "Active",
    parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null,
  });
  if (type === "Tenant") {
    org.tenantId = org.id;
    await org.save();
  }
  return org;
}

async function makeUser(org: Organization, username: string, overrides: Partial<InferCreationAttributes<User>> = {}): Promise<User> {
  return User.create({
    orgId: org.id, tenantId: org.tenantId, fullName: username, username, email: `${username}@example.io`,
    passwordHash: await hashPassword(PW), status: "Active",
    position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null,
    ...overrides,
  });
}

/** A Service Owner super-admin (bypasses requireAction) and its session. */
async function makeSoAdmin(): Promise<{ so: Organization; token: string }> {
  const so = await makeOrg("ServiceOwner", "AXIA");
  const admin = await makeUser(so, "soadmin");
  const role = await Role.create({ name: "SO Administrator", tierScope: "ServiceOwner", orgId: so.id, isSuperAdmin: true, status: true });
  await (admin as unknown as { setRoles: (r: Role[]) => Promise<unknown> }).setRoles([role]);
  const res = await login("soadmin");
  return { so, token: res.body.data.accessToken };
}

const login = (identifier: string, password = PW) =>
  request(app).post("/v1/auth/login").send({ identifier, password });

describe("auth hardening", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("refuses to grant SP-only actions to a non-Service-Owner role", async () => {
    const { so, token } = await makeSoAdmin();
    const tenant = await makeOrg("Tenant", "ACME");
    const tenantRole = await Role.create({ name: "Administrator", tierScope: "Tenant", orgId: tenant.id, isSuperAdmin: false, status: true });
    const soRole = await Role.create({ name: "Billing Manager", tierScope: "ServiceOwner", orgId: so.id, isSuperAdmin: false, status: true });

    const refused = await request(app).put(`/v1/roles/${tenantRole.id}/grants`).set(bearer(token))
      .send({ actionKeys: [ACTIONS.SITE_READ, ACTIONS.KB_MANAGE] });
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe("SP_ONLY_ACTION");

    const allowed = await request(app).put(`/v1/roles/${soRole.id}/grants`).set(bearer(token))
      .send({ actionKeys: [ACTIONS.KB_MANAGE] });
    expect(allowed.status).toBe(200);
  });

  it("matches the login identifier case-insensitively", async () => {
    await makeUser(await makeOrg("ServiceOwner", "AXIA"), "MixedCase");
    expect((await login("mixedcase")).status).toBe(200);
    expect((await login("MIXEDCASE@EXAMPLE.IO")).status).toBe(200);
  });

  describe("suspension", () => {
    it("refuses login for a user in a suspended org with the generic AUTH_FAILED", async () => {
      const dist = await makeOrg("Distributor", "NWP");
      await makeUser(dist, "partner");
      dist.status = "Suspended";
      await dist.save();
      const res = await login("partner");
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("AUTH_FAILED");
    });

    it("kills an existing access token and refresh token once the org is suspended", async () => {
      const { token: soToken } = await makeSoAdmin();
      const dist = await makeOrg("Distributor", "NWP");
      const partner = await makeUser(dist, "partner");
      const session = (await login("partner")).body.data as { accessToken: string; refreshToken: string };
      expect((await request(app).get("/v1/menu").set(bearer(session.accessToken))).status).toBe(200);

      const suspend = await request(app).post(`/v1/organizations/${dist.id}/suspend`).set(bearer(soToken));
      expect(suspend.status).toBe(200);

      const menu = await request(app).get("/v1/menu").set(bearer(session.accessToken));
      expect(menu.status).toBe(401);
      expect(menu.body.error.code).toBe("ACCOUNT_INACTIVE");
      expect((await request(app).post("/v1/auth/refresh").send({ refreshToken: session.refreshToken })).status).toBe(401);
      expect(await RefreshToken.count({ where: { userId: partner.id, revokedAt: null } })).toBe(0);
    });

    it("revokes a user's sessions when the user is suspended", async () => {
      const { so, token: soToken } = await makeSoAdmin();
      const member = await makeUser(so, "member");
      const session = (await login("member")).body.data as { accessToken: string; refreshToken: string };

      const res = await request(app).patch(`/v1/users/${member.id}/status`).set(bearer(soToken)).send({ status: "Suspended" });
      expect(res.status).toBe(200);

      expect(await RefreshToken.count({ where: { userId: member.id, revokedAt: null } })).toBe(0);
      expect((await request(app).get("/v1/menu").set(bearer(session.accessToken))).body.error.code).toBe("ACCOUNT_INACTIVE");
      expect((await request(app).post("/v1/auth/refresh").send({ refreshToken: session.refreshToken })).status).toBe(401);
      expect((await login("member")).body.error.code).toBe("AUTH_FAILED");
    });
  });

  it("locks the account after 10 failed logins, refusing even the right password", async () => {
    const user = await makeUser(await makeOrg("ServiceOwner", "AXIA"), "victim");
    for (let i = 0; i < 10; i++) {
      if (i === 5) resetRateLimits(); // stay under the per-IP login limiter
      expect((await login("victim", "WrongPass999")).status).toBe(401);
    }
    resetRateLimits();

    const locked = await login("victim");
    expect(locked.status).toBe(401);
    expect(locked.body.error.code).toBe("AUTH_FAILED");
    await user.reload();
    expect(user.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
    expect(await AuditLog.count({ where: { action: "auth.login.locked" } })).toBe(1);

    // Once the lock lapses, the right password works again.
    await User.update({ lockedUntil: new Date(Date.now() - 1000) }, { where: { id: user.id } });
    expect((await login("victim")).status).toBe(200);
  });

  describe("password reset", () => {
    const forgot = (email: string) => request(app).post("/v1/auth/password/forgot").send({ email });
    const reset = (token: string, password = "BrandNew123") =>
      request(app).post("/v1/auth/password/reset").send({ token, password });

    it("stores only a one-hour hash, is single use, revokes sessions and clears a lockout", async () => {
      const user = await makeUser(await makeOrg("ServiceOwner", "AXIA"), "forgetful");
      const session = (await login("forgetful")).body.data as { refreshToken: string };
      await User.update({ lockedUntil: new Date(Date.now() + 600_000) }, { where: { id: user.id } });

      expect((await forgot("FORGETFUL@example.io")).status).toBe(200);
      const raw = await lastMailedToken("forgetful@example.io");
      await user.reload();
      expect(user.resetToken).toBe(hashToken(raw));
      expect(user.resetToken).not.toBe(raw);
      const ttl = user.resetExpires!.getTime() - Date.now();
      expect(ttl).toBeGreaterThan(55 * 60_000);
      expect(ttl).toBeLessThanOrEqual(60 * 60_000);

      expect((await reset(raw)).status).toBe(200);
      const again = await reset(raw, "Another123");
      expect(again.status).toBe(400);
      expect(again.body.error.code).toBe("INVALID_TOKEN");

      expect((await request(app).post("/v1/auth/refresh").send({ refreshToken: session.refreshToken })).status).toBe(401);
      expect((await login("forgetful", "BrandNew123")).status).toBe(200);
    });

    it("rejects an expired reset token", async () => {
      const user = await makeUser(await makeOrg("ServiceOwner", "AXIA"), "late");
      await forgot("late@example.io");
      const raw = await lastMailedToken("late@example.io");
      await User.update({ resetExpires: new Date(Date.now() - 1000) }, { where: { id: user.id } });
      expect((await reset(raw)).body.error.code).toBe("INVALID_TOKEN");
    });

    it("answers identically for unknown and non-Active accounts and mails nothing", async () => {
      await makeUser(await makeOrg("ServiceOwner", "AXIA"), "parked", { status: "Suspended" });
      const unknown = await forgot("nobody@example.io");
      const parked = await forgot("parked@example.io");
      expect(unknown.status).toBe(200);
      expect(parked.body).toEqual(unknown.body);
      await expect(lastMailedToken("parked@example.io")).rejects.toThrow();
    });
  });

  describe("activation", () => {
    async function pendingUser(overrides: Partial<InferCreationAttributes<User>> = {}): Promise<string> {
      const invite = issueActivationToken();
      await makeUser(await makeOrg("ServiceOwner", "AXIA"), "newbie", {
        passwordHash: null, status: "Pending Activation", ...invite.fields, ...overrides,
      });
      return invite.raw;
    }
    const activate = (token: string) => request(app).post("/v1/auth/activate").send({ token, password: "BrandNew123" });

    it("activates a pending account once and clears the token", async () => {
      const raw = await pendingUser();
      expect((await activate(raw)).status).toBe(200);
      const user = await User.findOne({ where: { username: "newbie" } });
      expect(user!.status).toBe("Active");
      expect(user!.activationToken).toBeNull();
      expect((await activate(raw)).body.error.code).toBe("INVALID_TOKEN");
    });

    it("refuses a token held by a non-pending account", async () => {
      const raw = await pendingUser({ status: "Suspended" });
      expect((await activate(raw)).body.error.code).toBe("INVALID_TOKEN");
      expect((await User.findOne({ where: { username: "newbie" } }))!.status).toBe("Suspended");
    });

    it("refuses an expired activation token", async () => {
      const raw = await pendingUser({ activationTokenExpiresAt: new Date(Date.now() - 1000) });
      expect((await activate(raw)).body.error.code).toBe("INVALID_TOKEN");
    });
  });

  it("lets exactly one of two concurrent refreshes of the same token succeed", async () => {
    await makeUser(await makeOrg("ServiceOwner", "AXIA"), "racer");
    const { refreshToken } = (await login("racer")).body.data as { refreshToken: string };
    const results = await Promise.all([
      request(app).post("/v1/auth/refresh").send({ refreshToken }),
      request(app).post("/v1/auth/refresh").send({ refreshToken }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
  });
});
