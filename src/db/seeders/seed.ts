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
import { ROLES_BY_ORG_TYPE } from "../../modules/iam/role.catalog";
import type { OrgType } from "../models/organization.model";
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

/**
 * Create (idempotently) an organization's canonical role set per role.catalog,
 * scoped to that org and tier. Returns the roles keyed by name so callers can
 * grant access and attach demo users.
 */
async function ensureRoleSet(orgId: string, orgType: OrgType): Promise<Map<string, Role>> {
  const byName = new Map<string, Role>();
  for (const name of ROLES_BY_ORG_TYPE[orgType]) {
    const [role] = await Role.findOrCreate({
      where: { name, orgId },
      defaults: { name, tierScope: orgType, orgId, isSuperAdmin: false, status: true },
    });
    byName.set(name, role);
  }
  return byName;
}

/**
 * Apply grants to an org's role set: every Administrator gets full access;
 * specialist roles (Billing Manager / Technical Support / Team Member) get a
 * minimal read grant for now. Finer per-role grants are a follow-up.
 */
async function grantRoleSet(roles: Map<string, Role>): Promise<void> {
  for (const [name, role] of roles) {
    if (name === "Administrator") {
      await grantEverything(role.id);
    } else {
      await grantAccess(role.id, [], [ACTIONS.MENU_READ]);
    }
  }
}

async function ensureUser(
  username: string,
  fullName: string,
  email: string,
  orgId: string,
  role: Role,
  tenantId: string | null = null,
): Promise<void> {
  const [user] = await User.findOrCreate({
    where: { username },
    defaults: {
      orgId,
      tenantId,
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

  // 3. ServiceOwner roles. The hidden "Super Admin" (bypass) is ServiceOwner-only
  //    and is NOT part of the assignable catalog; the catalog roles are added via
  //    ensureRoleSet (Administrator, Billing Manager, Technical Support).
  const [superAdminRole] = await Role.findOrCreate({
    where: { name: "Super Admin", orgId: so.id },
    defaults: { name: "Super Admin", tierScope: "ServiceOwner", orgId: so.id, isSuperAdmin: true, status: true },
  });
  const soRoles = await ensureRoleSet(so.id, "ServiceOwner");

  // 4. Grants. Super Admin bypasses checks (and also gets explicit grants so the
  //    grant matrix UI shows it fully enabled). Administrator = full CRUD;
  //    specialist roles get minimal read for now.
  await grantEverything(superAdminRole.id);
  await grantRoleSet(soRoles);

  // 5. Demo users for the SO org: super admin, administrator, and one per
  //    specialist role (Technical Support / Billing Manager) so every seeded
  //    user references a role that exists.
  await ensureUser("soadmin", "Super Admin", "soadmin@axia.io", so.id, superAdminRole);
  await ensureUser("admin", "Administrator", "admin@axia.io", so.id, soRoles.get("Administrator")!);
  await ensureUser("support", "Technical Support", "support@axia.io", so.id, soRoles.get("Technical Support")!);
  await ensureUser("billing", "Billing Manager", "billing@axia.io", so.id, soRoles.get("Billing Manager")!);

  // 6. Platform subscription for the SO org.
  await Subscription.findOrCreate({
    where: { orgId: so.id },
    defaults: { orgId: so.id, plan: "platform", entitlements: { all: true }, status: "Active", startDate: new Date(), endDate: null },
  });

  // 7. Demo Distributor org with its canonical role set + one user per role.
  const [dist] = await Organization.findOrCreate({
    where: { code: "NWP" },
    defaults: {
      name: "Northwind Partners", code: "NWP", type: "Distributor", status: "Active",
      parentOrgId: so.id, tenantId: null, email: "ops@northwind.io", phone: null, website: null, country: "SG", address: null,
    },
  });
  const distRoles = await ensureRoleSet(dist.id, "Distributor");
  await grantRoleSet(distRoles);
  await ensureUser("distadmin", "Distributor Admin", "admin@northwind.io", dist.id, distRoles.get("Administrator")!);
  await ensureUser("distsupport", "Distributor Support", "support@northwind.io", dist.id, distRoles.get("Technical Support")!);
  await ensureUser("distbilling", "Distributor Billing", "billing@northwind.io", dist.id, distRoles.get("Billing Manager")!);

  // 8. Demo Tenant org with its canonical role set + one user per role.
  const [tenant] = await Organization.findOrCreate({
    where: { code: "ACME" },
    defaults: {
      name: "Acme Corp", code: "ACME", type: "Tenant", status: "Active",
      parentOrgId: dist.id, tenantId: null, email: "it@acme.com", phone: null, website: null, country: "SG", address: null,
    },
  });
  if (!tenant.tenantId) {
    tenant.tenantId = tenant.id;
    await tenant.save();
  }
  const tenantRoles = await ensureRoleSet(tenant.id, "Tenant");
  await grantRoleSet(tenantRoles);
  await ensureUser("tenantadmin", "Tenant Admin", "admin@acme.com", tenant.id, tenantRoles.get("Administrator")!, tenant.id);
  await ensureUser("tenantbilling", "Tenant Billing", "billing@acme.com", tenant.id, tenantRoles.get("Billing Manager")!, tenant.id);
  await ensureUser("tenantmember", "Tenant Member", "member@acme.com", tenant.id, tenantRoles.get("Team Member")!, tenant.id);

  // eslint-disable-next-line no-console
  console.log(
    [
      "Seed complete.",
      "  Orgs: AXIA (ServiceOwner), Northwind Partners (Distributor), Acme Corp (Tenant)",
      "  Roles per org: Super Admin (SO only, bypass) + Administrator (full CRUD) + specialists (read-only)",
      `  Users (password ${DEFAULT_PASSWORD}): soadmin / admin / support / billing / distadmin / distsupport / distbilling / tenantadmin / tenantbilling / tenantmember`,
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
