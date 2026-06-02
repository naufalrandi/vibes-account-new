import "dotenv/config";
import { sequelize } from "../sequelize";
import {
  initModels,
  Organization,
  User,
  Role,
  Menu,
  Action,
  RoleMenuGrant,
  RoleActionGrant,
  Subscription,
} from "../models";
import { ACTIONS, MENU_SEED, type SeedMenu } from "../../modules/iam/actions.catalog";
import { hashPassword } from "../../lib/password";

const DEFAULT_PASSWORD = "ChangeMe123";

// belongsToMany generates a `setRoles` mixin at runtime; the User model does not
// declare it, so reach it through a narrow association-only cast.
type WithSetRoles = { setRoles: (roles: Role[]) => Promise<unknown> };

async function seedMenuTree(nodes: SeedMenu[], parentId: string | null, baseSort: number): Promise<void> {
  let sort = baseSort;
  for (const node of nodes) {
    sort += 1;
    const [menu] = await Menu.findOrCreate({
      where: { name: node.name, parentId },
      defaults: {
        parentId,
        name: node.name,
        heading: node.heading ?? null,
        route: node.route ?? null,
        routeSeo: node.routeSeo ?? null,
        icon: node.icon ?? null,
        sorting: sort,
        status: true,
      },
    });
    let aSort = 0;
    for (const action of node.actions ?? []) {
      aSort += 1;
      await Action.findOrCreate({
        where: { key: action.key },
        defaults: { menuId: menu.id, key: action.key, name: action.name, sorting: aSort, status: true },
      });
    }
    if (node.children?.length) await seedMenuTree(node.children, menu.id, 0);
  }
}

/** Grant a role every menu + every action (full access, explicit grants). */
async function grantEverything(roleId: string): Promise<void> {
  for (const menu of await Menu.findAll()) {
    await RoleMenuGrant.findOrCreate({ where: { roleId, menuId: menu.id }, defaults: { roleId, menuId: menu.id, granted: true } });
  }
  for (const action of await Action.findAll()) {
    await RoleActionGrant.findOrCreate({ where: { roleId, actionId: action.id }, defaults: { roleId, actionId: action.id, granted: true } });
  }
}

/** Grant a role specific menus (by name) and specific action keys. */
async function grantAccess(roleId: string, menuNames: string[], actionKeys: string[]): Promise<void> {
  const menus = await Menu.findAll();
  const byName = new Map(menus.map((m) => [m.name, m]));
  for (const name of menuNames) {
    const menu = byName.get(name);
    if (menu) {
      await RoleMenuGrant.findOrCreate({ where: { roleId, menuId: menu.id }, defaults: { roleId, menuId: menu.id, granted: true } });
    }
  }
  const actions = await Action.findAll({ where: { key: actionKeys } });
  for (const action of actions) {
    await RoleActionGrant.findOrCreate({ where: { roleId, actionId: action.id }, defaults: { roleId, actionId: action.id, granted: true } });
  }
}

async function ensureUser(
  username: string,
  fullName: string,
  email: string,
  orgId: string,
  role: Role,
): Promise<void> {
  const [user] = await User.findOrCreate({
    where: { username },
    defaults: {
      orgId,
      tenantId: null,
      fullName,
      username,
      email,
      passwordHash: await hashPassword(DEFAULT_PASSWORD),
      status: "Active",
      position: role.name,
      workUnit: null,
      lastLogin: null,
      activationToken: null,
      resetToken: null,
      resetExpires: null,
    },
  });
  await (user as unknown as WithSetRoles).setRoles([role]);
}

export async function seed(): Promise<void> {
  initModels();
  await sequelize.authenticate();

  // 1. Menus + actions (the CRUD-style operation catalog).
  await seedMenuTree(MENU_SEED, null, 0);

  // 2. Service Owner organization.
  const [so] = await Organization.findOrCreate({
    where: { code: "AXIA" },
    defaults: {
      name: "AXIA", code: "AXIA", type: "ServiceOwner", status: "Active",
      parentOrgId: null, tenantId: null, email: "ops@axia.io", phone: null, website: null, country: "SG", address: null,
    },
  });

  // 3. Roles: Super Admin (bypass), Administrator (all grants), User (read-only).
  const [superAdminRole] = await Role.findOrCreate({
    where: { name: "Super Admin", orgId: so.id },
    defaults: { name: "Super Admin", tierScope: "ServiceOwner", orgId: so.id, isSuperAdmin: true, status: true },
  });
  const [adminRole] = await Role.findOrCreate({
    where: { name: "Administrator", orgId: so.id },
    defaults: { name: "Administrator", tierScope: "ServiceOwner", orgId: so.id, isSuperAdmin: false, status: true },
  });
  const [userRole] = await Role.findOrCreate({
    where: { name: "User", orgId: so.id },
    defaults: { name: "User", tierScope: "ServiceOwner", orgId: so.id, isSuperAdmin: false, status: true },
  });

  // 4. Grants. Super Admin bypasses checks (and also gets explicit grants so the
  //    grant matrix UI shows it fully enabled). Administrator = full CRUD.
  await grantEverything(superAdminRole.id);
  await grantEverything(adminRole.id);
  // User = read-only: can view the main sections + read, nothing that mutates.
  await grantAccess(
    userRole.id,
    ["Dashboard", "Organizations", "Users", "Roles & Access", "Audit Log"],
    [ACTIONS.ORG_READ, ACTIONS.USER_READ, ACTIONS.ROLE_READ, ACTIONS.MENU_READ, ACTIONS.AUDIT_READ],
  );

  // 5. One demo user per role (all under the SO org → Service-Owner scope).
  await ensureUser("soadmin", "Super Admin", "soadmin@axia.io", so.id, superAdminRole);
  await ensureUser("admin", "Administrator", "admin@axia.io", so.id, adminRole);
  await ensureUser("user", "Standard User", "user@axia.io", so.id, userRole);

  // 6. Platform subscription for the SO org.
  await Subscription.findOrCreate({
    where: { orgId: so.id },
    defaults: { orgId: so.id, plan: "platform", entitlements: { all: true }, status: "Active", startDate: new Date(), endDate: null },
  });

  // eslint-disable-next-line no-console
  console.log(
    [
      "Seed complete.",
      "  Org: AXIA (ServiceOwner)",
      "  Roles: Super Admin (bypass), Administrator (full CRUD grants), User (read-only)",
      `  Users (password ${DEFAULT_PASSWORD}): soadmin / admin / user`,
    ].join("\n"),
  );
}

if (require.main === module) {
  seed()
    .then(() => sequelize.close())
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
