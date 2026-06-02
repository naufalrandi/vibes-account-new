import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import { initModels, Organization, User } from "../../db/models";
import { hashPassword } from "../../lib/password";
import { resetDb } from "../../../test/helpers";

const app = createApp();

async function makeActiveUser() {
  const org = await Organization.create({
    name: "AXIA", code: "AXIA", type: "ServiceOwner", status: "Active",
    parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null,
  });
  await User.create({
    orgId: org.id, tenantId: null, fullName: "Admin", username: "soadmin", email: "soadmin@axia.io",
    passwordHash: await hashPassword("ChangeMe123"), status: "Active",
    position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null,
  });
}

describe("auth", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("logs in with valid credentials and returns tokens", async () => {
    await makeActiveUser();
    const res = await request(app).post("/v1/auth/login").send({ identifier: "soadmin", password: "ChangeMe123" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.accessToken).toBeTruthy();
    expect(res.body.data.refreshToken).toBeTruthy();
  });

  it("rejects wrong password with AUTH_FAILED", async () => {
    await makeActiveUser();
    const res = await request(app).post("/v1/auth/login").send({ identifier: "soadmin", password: "wrong" });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("AUTH_FAILED");
  });

  it("refreshes an access token", async () => {
    await makeActiveUser();
    const login = await request(app).post("/v1/auth/login").send({ identifier: "soadmin@axia.io", password: "ChangeMe123" });
    const res = await request(app).post("/v1/auth/refresh").send({ refreshToken: login.body.data.refreshToken });
    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeTruthy();
  });
});
