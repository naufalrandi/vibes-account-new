import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import { initModels, Organization, User, Role, Menu, Action, RoleActionGrant, RoleMenuGrant } from "../../db/models";
import { hashPassword } from "../../lib/password";
import { resetDb } from "../../../test/helpers";

const app = createApp();

describe("menu", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("returns the role-filtered menu tree + access map for the current user", async () => {
    const so = await Organization.create({
      name: "Acme", code: "ACME", type: "Tenant", status: "Active",
      parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null,
    });
    const user = await User.create({
      orgId: so.id, tenantId: so.id, fullName: "U", username: "tadmin", email: "t@acme.com",
      passwordHash: await hashPassword("ChangeMe123"), status: "Active",
      position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null,
    });
    const role = await Role.create({ name: "Tenant Admin", tierScope: "Tenant", orgId: so.id, isSuperAdmin: false, status: true });
    // belongsToMany generates a `setRoles` mixin at runtime; `.set("Roles", ...)` only
    // sets an in-memory data value and never persists the join row.
    await (user as unknown as { setRoles: (roles: Role[]) => Promise<unknown> }).setRoles([role]);
    const menu = await Menu.create({ parentId: null, name: "Users", route: "/users", routeSeo: "users", icon: null, sorting: 1, status: true });
    const action = await Action.create({ menuId: menu.id, key: "user.read", name: "View", sorting: 1, status: true });
    await RoleMenuGrant.create({ roleId: role.id, menuId: menu.id, granted: true });
    await RoleActionGrant.create({ roleId: role.id, actionId: action.id, granted: true });

    const login = await request(app).post("/v1/auth/login").send({ identifier: "tadmin", password: "ChangeMe123" });
    const res = await request(app).get("/v1/menu").set("authorization", `Bearer ${login.body.data.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.menu.some((m: { route: string }) => m.route === "/users")).toBe(true);
    expect(res.body.data.access["user.read"]).toBe(true);
  });
});
