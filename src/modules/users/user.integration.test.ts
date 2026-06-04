import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import { initModels, Organization, User, Role } from "../../db/models";
import { hashPassword } from "../../lib/password";
import { resetDb } from "../../../test/helpers";

const app = createApp();

async function seedAdminAndLogin(): Promise<{ token: string; tenantOrgId: string }> {
  const so = await Organization.create({
    name: "AXIA", code: "AXIA", type: "ServiceOwner", status: "Active",
    parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null,
  });
  const tenant = await Organization.create({
    name: "Acme", code: "ACME", type: "Tenant", status: "Active",
    parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null,
  });
  tenant.tenantId = tenant.id;
  await tenant.save();

  const admin = await User.create({
    orgId: so.id, tenantId: null, fullName: "Admin", username: "soadmin", email: "soadmin@axia.io",
    passwordHash: await hashPassword("ChangeMe123"), status: "Active",
    position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null,
  });
  // SO Administrator is a super-admin → bypasses requireAction for all user routes.
  const role = await Role.create({ name: "SO Administrator", tierScope: "ServiceOwner", orgId: so.id, isSuperAdmin: true, status: true });
  // belongsToMany generates a `setRoles` mixin at runtime; `.set("Roles", ...)` is the
  // generic attribute setter and does NOT persist the association (matches seed.ts).
  await (admin as unknown as { setRoles: (roles: Role[]) => Promise<unknown> }).setRoles([role]);

  const login = await request(app).post("/v1/auth/login").send({ identifier: "soadmin", password: "ChangeMe123" });
  return { token: login.body.data.accessToken, tenantOrgId: tenant.id };
}

describe("users", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("creates a user (PendingActivation) in an existing org", async () => {
    const { token, tenantOrgId } = await seedAdminAndLogin();
    const res = await request(app)
      .post("/v1/users")
      .set("authorization", `Bearer ${token}`)
      .send({ orgId: tenantOrgId, fullName: "Jane Doe", username: "jdoe", email: "jane@acme.com" });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe("PendingActivation");
    // Credential-bearing fields must never leak in the response (the
    // activationToken authorizes /v1/auth/activate).
    expect(res.body.data).not.toHaveProperty("passwordHash");
    expect(res.body.data).not.toHaveProperty("activationToken");
    expect(res.body.data).not.toHaveProperty("resetToken");
    expect(res.body.data).not.toHaveProperty("resetExpires");
  });

  it("rejects user creation for a non-existent org (FR-1)", async () => {
    const { token } = await seedAdminAndLogin();
    const res = await request(app)
      .post("/v1/users")
      .set("authorization", `Bearer ${token}`)
      .send({ orgId: "00000000-0000-0000-0000-000000000000", fullName: "X", username: "x", email: "x@x.com" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("ORG_NOT_FOUND");
  });

  it("blocks unauthenticated access", async () => {
    const res = await request(app).get("/v1/users");
    expect(res.status).toBe(401);
  });

  it("lists users filtered by status", async () => {
    const { token, tenantOrgId } = await seedAdminAndLogin();
    await request(app).post("/v1/users").set("authorization", `Bearer ${token}`)
      .send({ orgId: tenantOrgId, fullName: "A", username: "a", email: "a@acme.com" });
    const res = await request(app).get("/v1/users?status=PendingActivation").set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data.every((u: { status: string }) => u.status === "PendingActivation")).toBe(true);
    expect(
      res.body.data.every(
        (u: Record<string, unknown>) =>
          !("passwordHash" in u) && !("activationToken" in u) && !("resetToken" in u) && !("resetExpires" in u),
      ),
    ).toBe(true);
  });

  it("searches users by email or username (single term)", async () => {
    const { token, tenantOrgId } = await seedAdminAndLogin();
    await request(app).post("/v1/users").set("authorization", `Bearer ${token}`)
      .send({ orgId: tenantOrgId, fullName: "Alice", username: "alice", email: "alice@acme.com" });
    await request(app).post("/v1/users").set("authorization", `Bearer ${token}`)
      .send({ orgId: tenantOrgId, fullName: "Bob", username: "bob", email: "bob@acme.com" });

    // Match on username substring.
    const byName = await request(app).get("/v1/users?search=alic").set("authorization", `Bearer ${token}`);
    expect(byName.status).toBe(200);
    expect(byName.body.data.map((u: { username: string }) => u.username)).toContain("alice");
    expect(byName.body.data.map((u: { username: string }) => u.username)).not.toContain("bob");

    // Match on email substring.
    const byEmail = await request(app).get("/v1/users?search=bob@").set("authorization", `Bearer ${token}`);
    expect(byEmail.body.data.map((u: { username: string }) => u.username)).toContain("bob");
  });

  it("invites a user with a role and filters the list by that role", async () => {
    const { token, tenantOrgId } = await seedAdminAndLogin();
    // Seed a role whose name we can invite into and filter by.
    const memberRole = await Role.create({ name: "Member", tierScope: "Tenant", orgId: tenantOrgId, isSuperAdmin: false, status: true });

    const created = await request(app).post("/v1/users").set("authorization", `Bearer ${token}`)
      .send({ orgId: tenantOrgId, fullName: "Carol", username: "carol", email: "carol@acme.com", role: "Member" });
    expect(created.status).toBe(201);

    const filtered = await request(app).get("/v1/users?role=Member").set("authorization", `Bearer ${token}`);
    expect(filtered.status).toBe(200);
    expect(filtered.body.data.length).toBe(1);
    expect(filtered.body.data[0].username).toBe("carol");
    expect(memberRole.id).toBeTruthy();
  });

  it("removes a user", async () => {
    const { token, tenantOrgId } = await seedAdminAndLogin();
    const created = await request(app).post("/v1/users").set("authorization", `Bearer ${token}`)
      .send({ orgId: tenantOrgId, fullName: "Dave", username: "dave", email: "dave@acme.com" });
    const id = created.body.data.id;

    const del = await request(app).delete(`/v1/users/${id}`).set("authorization", `Bearer ${token}`);
    expect(del.status).toBe(200);
    expect(del.body.data.removed).toBe(true);

    const after = await request(app).get("/v1/users?search=dave").set("authorization", `Bearer ${token}`);
    expect(after.body.data.map((u: { username: string }) => u.username)).not.toContain("dave");
  });

  it("returns 404 when removing a non-existent user", async () => {
    const { token } = await seedAdminAndLogin();
    const del = await request(app)
      .delete("/v1/users/00000000-0000-0000-0000-000000000000")
      .set("authorization", `Bearer ${token}`);
    expect(del.status).toBe(404);
  });
});
