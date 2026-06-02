import { describe, expect, it, beforeAll, afterEach } from "vitest";
import { initModels, Organization, User, Role, Menu, Action, UserRole, RoleActionGrant, RoleMenuGrant } from "../../db/models";
import { getEffectiveAccess, buildMenuForUser } from "./access.service";
import { resetDb } from "../../../test/helpers";

async function makeUserWithRole(opts: { isSuperAdmin?: boolean }) {
  const org = await Organization.create({
    name: "T", code: "T1", type: "Tenant", status: "Active",
    parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null,
  });
  const user = await User.create({
    orgId: org.id, tenantId: org.id, fullName: "U", username: "u1", email: "u1@t.com",
    passwordHash: null, status: "Active", position: null, workUnit: null, lastLogin: null,
    activationToken: null, resetToken: null, resetExpires: null,
  });
  const role = await Role.create({ name: "R", tierScope: "Tenant", orgId: org.id, isSuperAdmin: !!opts.isSuperAdmin, status: true });
  await UserRole.create({ userId: user.id, roleId: role.id });
  return { user, role };
}

describe("access.service", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("unions granted action keys across a user's roles", async () => {
    const { user, role } = await makeUserWithRole({});
    const menu = await Menu.create({ parentId: null, name: "Users", route: "/users", routeSeo: "users", icon: null, sorting: 1, status: true });
    const a1 = await Action.create({ menuId: menu.id, key: "user.read", name: "View", sorting: 1, status: true });
    const a2 = await Action.create({ menuId: menu.id, key: "user.create", name: "Create", sorting: 2, status: true });
    await RoleActionGrant.create({ roleId: role.id, actionId: a1.id, granted: true });
    await RoleActionGrant.create({ roleId: role.id, actionId: a2.id, granted: false });
    await RoleMenuGrant.create({ roleId: role.id, menuId: menu.id, granted: true });

    const access = await getEffectiveAccess(user.id);
    expect(access.isSuperAdmin).toBe(false);
    expect(access.actionKeys).toEqual(["user.read"]); // a2 not granted

    const tree = await buildMenuForUser(user.id);
    expect(tree.access["user.read"]).toBe(true);
    expect(tree.access["user.create"]).toBeUndefined();
    expect(tree.menu.some((m) => m.route === "/users")).toBe(true);
  });

  it("super-admin sees all menus/actions regardless of grants", async () => {
    const { user } = await makeUserWithRole({ isSuperAdmin: true });
    const menu = await Menu.create({ parentId: null, name: "Audit", route: "/audit", routeSeo: "audit", icon: null, sorting: 1, status: true });
    await Action.create({ menuId: menu.id, key: "audit.read", name: "View", sorting: 1, status: true });

    const access = await getEffectiveAccess(user.id);
    expect(access.isSuperAdmin).toBe(true);
    const tree = await buildMenuForUser(user.id);
    expect(tree.access["audit.read"]).toBe(true);
    expect(tree.menu.some((m) => m.route === "/audit")).toBe(true);
  });
});
