import "dotenv/config";
import { sequelize } from "../sequelize";
import { initModels, Organization, User, Role, Menu, Action, Subscription } from "../models";
import { MENU_SEED, type SeedMenu } from "../../modules/iam/actions.catalog";
import { hashPassword } from "../../lib/password";

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

export async function seed(): Promise<void> {
  initModels();
  await sequelize.authenticate();

  await seedMenuTree(MENU_SEED, null, 0);

  const [so] = await Organization.findOrCreate({
    where: { code: "AXIA" },
    defaults: {
      name: "AXIA", code: "AXIA", type: "ServiceOwner", status: "Active",
      parentOrgId: null, tenantId: null, email: "ops@axia.io", phone: null, website: null, country: "SG", address: null,
    },
  });

  // SO Administrator role is a super-admin (bypasses all action checks).
  const [soAdminRole] = await Role.findOrCreate({
    where: { name: "SO Administrator", orgId: so.id },
    defaults: { name: "SO Administrator", tierScope: "ServiceOwner", orgId: so.id, isSuperAdmin: true, status: true },
  });

  const [admin] = await User.findOrCreate({
    where: { username: "soadmin" },
    defaults: {
      orgId: so.id, tenantId: null, fullName: "Service Owner Admin", username: "soadmin", email: "soadmin@axia.io",
      passwordHash: await hashPassword("ChangeMe123"), status: "Active", position: "Administrator", workUnit: null,
      lastLogin: null, activationToken: null, resetToken: null, resetExpires: null,
    },
  });
  // belongsToMany generates a `setRoles` mixin at runtime; the User model does not
  // declare it, so reach it through a narrow cast (minimal, association-only).
  await (admin as unknown as { setRoles: (roles: Role[]) => Promise<unknown> }).setRoles([soAdminRole]);

  await Subscription.findOrCreate({
    where: { orgId: so.id },
    defaults: { orgId: so.id, plan: "platform", entitlements: { all: true }, status: "Active", startDate: new Date(), endDate: null },
  });

  // eslint-disable-next-line no-console
  console.log("Seed complete: menus+actions, SO org=AXIA, admin username=soadmin / password=ChangeMe123");
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
