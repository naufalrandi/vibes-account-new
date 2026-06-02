import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import { initModels, Organization, User, Role } from "../../db/models";
import { hashPassword } from "../../lib/password";
import { resetDb } from "../../../test/helpers";

const app = createApp();

describe("audit", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("records a login and exposes it in the audit trail", async () => {
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
    // belongsToMany generates a `setRoles` mixin at runtime; `.set("Roles", ...)` only
    // sets an in-memory data value and never persists the join row.
    await (admin as unknown as { setRoles: (roles: Role[]) => Promise<unknown> }).setRoles([role]);

    const login = await request(app).post("/v1/auth/login").send({ identifier: "soadmin", password: "ChangeMe123" });
    const res = await request(app).get("/v1/audit").set("authorization", `Bearer ${login.body.data.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.some((a: { action: string }) => a.action === "auth.login.succeeded")).toBe(true);
  });
});
