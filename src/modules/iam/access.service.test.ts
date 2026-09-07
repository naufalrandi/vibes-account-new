import { describe, expect, it, beforeAll, afterEach } from "vitest";
import { initModels, Organization, User, Role, Menu, Action, UserRole, RoleActionGrant, RoleMenuGrant } from "../../db/models";
import { getEffectiveAccess, buildMenuForUser, isUserSuperAdmin, acDefaultLevel, levelActions, PERM_LEVELS } from "./access.service";
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

  // OD `tmProvisioned` (js/core.js:4913-4917) — `provisioned===false` is "No
  // access", so revoking platform access (js/core.js:5216) has to clamp the
  // role grants a member still holds, not just the ones `updateUser` removes.
  it("grants nothing to a de-provisioned member, whatever their roles hold", async () => {
    const { user, role } = await makeUserWithRole({});
    const menu = await Menu.create({ parentId: null, name: "Users", route: "/users", routeSeo: "users", icon: null, sorting: 1, status: true });
    const a1 = await Action.create({ menuId: menu.id, key: "user.read", name: "View", sorting: 1, status: true });
    await RoleActionGrant.create({ roleId: role.id, actionId: a1.id, granted: true });
    await RoleMenuGrant.create({ roleId: role.id, menuId: menu.id, granted: true });
    expect((await getEffectiveAccess(user.id)).actionKeys).toEqual(["user.read"]);

    user.provisioned = false;
    await user.save();

    const access = await getEffectiveAccess(user.id);
    expect(access.isSuperAdmin).toBe(false);
    expect(access.actionKeys).toEqual([]);
    expect(access.menuIds).toEqual([]);
    // The role membership itself survives — OD keeps showing the group.
    expect(access.roleNames).toEqual(["R"]);
    const tree = await buildMenuForUser(user.id);
    expect(tree.menu).toEqual([]);
    expect(tree.access).toEqual({});
  });

  // OD `u.superAdmin` (js/core.js:151) is a per-USER boolean read by `acInit`
  // (js/core.js:5081), not a role — `user.service.ts` already locks the account
  // on that column, so authorization has to read it too.
  it("treats the per-user superAdmin column as super-admin without a super-admin role", async () => {
    const { user } = await makeUserWithRole({});
    const menu = await Menu.create({ parentId: null, name: "Audit", route: "/audit", routeSeo: "audit", icon: null, sorting: 1, status: true });
    await Action.create({ menuId: menu.id, key: "audit.read", name: "View", sorting: 1, status: true });
    expect((await getEffectiveAccess(user.id)).isSuperAdmin).toBe(false);

    user.superAdmin = true;
    await user.save();

    expect((await getEffectiveAccess(user.id)).isSuperAdmin).toBe(true);
    expect(await isUserSuperAdmin(user.id)).toBe(true);
    const tree = await buildMenuForUser(user.id);
    expect(tree.access["audit.read"]).toBe(true);
    expect(tree.menu.some((m) => m.route === "/audit")).toBe(true);
  });

  // `acInit` reads `granted = sa || tmProvisioned(u)` (js/core.js:5084) and
  // `acToggleAccess` no-ops when locked (js/core.js:5158): a super admin's
  // access cannot be revoked, so the clamp above must not apply to one.
  it("does not clamp a super admin on the provisioned flag", async () => {
    const { user } = await makeUserWithRole({ isSuperAdmin: true });
    const menu = await Menu.create({ parentId: null, name: "Audit", route: "/audit", routeSeo: "audit", icon: null, sorting: 1, status: true });
    await Action.create({ menuId: menu.id, key: "audit.read", name: "View", sorting: 1, status: true });
    user.provisioned = false;
    await user.save();

    expect((await getEffectiveAccess(user.id)).isSuperAdmin).toBe(true);
    expect((await buildMenuForUser(user.id)).access["audit.read"]).toBe(true);
  });
});

describe("permission levels (OD js/core.js:5063-5070)", () => {
  it("exposes the four OD levels in order", () => {
    expect(PERM_LEVELS).toEqual(["View", "Edit", "Approve", "Manage"]);
  });

  it("narrows the level whitelist to the menu archetype's actions", () => {
    // 'team' is a `record` menu: view/create/edit/delete/export/assign.
    expect(levelActions("View", "team")).toEqual(["view", "export"]);
    expect(levelActions("Edit", "team")).toEqual(["view", "create", "edit", "export"]);
    expect(levelActions("Manage", "team")).toEqual(["view", "create", "edit", "delete", "export", "assign"]);
  });

  it("defaults the level from the role: Administrator->Manage, Basic User->View, else Edit", () => {
    expect(acDefaultLevel("Administrator")).toBe("Manage");
    expect(acDefaultLevel("Basic User")).toBe("View");
    expect(acDefaultLevel("Billing Manager")).toBe("Edit");
    expect(acDefaultLevel(null)).toBe("Edit");
  });
});
