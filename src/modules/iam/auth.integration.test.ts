import { describe, expect, it, beforeAll, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import { initModels, Organization, User, RefreshToken, AuditLog } from "../../db/models";
import { hashPassword } from "../../lib/password";
import { resetDb } from "../../../test/helpers";
import { resetRateLimits } from "../../middleware/rateLimit";

const app = createApp();

async function makeActiveUser(): Promise<User> {
  const org = await Organization.create({
    name: "AXIA", code: "AXIA", type: "ServiceOwner", status: "Active",
    parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null,
  });
  return User.create({
    orgId: org.id, tenantId: null, fullName: "Admin", username: "soadmin", email: "soadmin@axia.io",
    passwordHash: await hashPassword("ChangeMe123"), status: "Active",
    position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null,
  });
}

async function loginOk() {
  const res = await request(app).post("/v1/auth/login").send({ identifier: "soadmin", password: "ChangeMe123" });
  expect(res.status).toBe(200);
  return res.body.data as { accessToken: string; refreshToken: string };
}

describe("auth", () => {
  beforeAll(() => initModels());
  beforeEach(() => resetRateLimits());
  afterEach(() => resetDb());

  it("logs in with valid credentials and returns tokens", async () => {
    await makeActiveUser();
    const res = await request(app).post("/v1/auth/login").send({ identifier: "soadmin", password: "ChangeMe123" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.accessToken).toBeTruthy();
    expect(res.body.data.refreshToken).toBeTruthy();
    expect(res.body.data.user.orgType).toBe("ServiceOwner");
    expect(res.body.data.user.orgName).toBeTruthy();
    expect(Array.isArray(res.body.data.user.roles)).toBe(true);
  });

  it("rejects wrong password with AUTH_FAILED", async () => {
    await makeActiveUser();
    const res = await request(app).post("/v1/auth/login").send({ identifier: "soadmin", password: "wrong" });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("AUTH_FAILED");
  });

  it("does not reveal whether an inactive user exists (same AUTH_FAILED)", async () => {
    const user = await makeActiveUser();
    user.status = "Suspended";
    await user.save();
    const res = await request(app).post("/v1/auth/login").send({ identifier: "soadmin", password: "ChangeMe123" });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("AUTH_FAILED");
  });

  it("refreshes an access token and rotates the refresh token", async () => {
    await makeActiveUser();
    const first = await loginOk();
    const res = await request(app).post("/v1/auth/refresh").send({ refreshToken: first.refreshToken });
    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeTruthy();
    expect(res.body.data.refreshToken).toBeTruthy();
    // Rotation: a new refresh token is issued, different from the one presented.
    expect(res.body.data.refreshToken).not.toBe(first.refreshToken);
  });

  it("rejects the old refresh token after rotation and revokes all sessions on reuse", async () => {
    const user = await makeActiveUser();
    const first = await loginOk();
    const rotated = await request(app).post("/v1/auth/refresh").send({ refreshToken: first.refreshToken });
    const second = rotated.body.data.refreshToken as string;

    // Reusing the rotated-out token is rejected...
    const reuse = await request(app).post("/v1/auth/refresh").send({ refreshToken: first.refreshToken });
    expect(reuse.status).toBe(401);

    // ...and reuse detection revokes every live session, so even the freshly
    // issued token no longer works.
    const afterReuse = await request(app).post("/v1/auth/refresh").send({ refreshToken: second });
    expect(afterReuse.status).toBe(401);

    const live = await RefreshToken.count({ where: { userId: user.id, revokedAt: null } });
    expect(live).toBe(0);
  });

  it("logout revokes the refresh token and blocks further refresh", async () => {
    await makeActiveUser();
    const { refreshToken } = await loginOk();
    const out = await request(app).post("/v1/auth/logout").send({ refreshToken });
    expect(out.status).toBe(200);
    expect(out.body.data.loggedOut).toBe(true);

    const res = await request(app).post("/v1/auth/refresh").send({ refreshToken });
    expect(res.status).toBe(401);

    const logoutAudit = await AuditLog.count({ where: { action: "auth.logout" } });
    expect(logoutAudit).toBeGreaterThan(0);
  });

  it("rejects refresh for an inactive user", async () => {
    const user = await makeActiveUser();
    const { refreshToken } = await loginOk();
    user.status = "Suspended";
    await user.save();
    const res = await request(app).post("/v1/auth/refresh").send({ refreshToken });
    expect(res.status).toBe(401);
  });

  it("rejects an expired refresh token", async () => {
    const user = await makeActiveUser();
    const { refreshToken } = await loginOk();
    await RefreshToken.update({ expiresAt: new Date(Date.now() - 1000) }, { where: { userId: user.id } });
    const res = await request(app).post("/v1/auth/refresh").send({ refreshToken });
    expect(res.status).toBe(401);
  });

  it("rejects a malformed refresh token", async () => {
    const res = await request(app).post("/v1/auth/refresh").send({ refreshToken: "not-a-jwt" });
    expect(res.status).toBe(401);
  });
});
