import { sequelize } from "../src/db/sequelize";
import { Menu, Action, RoleActionGrant } from "../src/db/models";

/** Truncate all tables between tests, preserving structure. */
export async function resetDb(): Promise<void> {
  await sequelize.query(
    'TRUNCATE TABLE "refresh_tokens","login_history","audit_logs","registration_requests","subscriptions","role_action_grants","role_menu_grants","user_roles","actions","menus","users","roles","organizations" RESTART IDENTITY CASCADE',
  );
}

/**
 * Grant specific action keys to a role for tests: ensures a menu + the actions
 * exist, then creates granted RoleActionGrant rows. Use for non-super-admin roles.
 */
export async function grantActions(roleId: string, keys: string[]): Promise<void> {
  const [menu] = await Menu.findOrCreate({
    where: { name: "TestMenu", parentId: null },
    defaults: { parentId: null, name: "TestMenu", heading: null, route: "/test", routeSeo: "test", icon: null, sorting: 1, status: true },
  });
  for (const key of keys) {
    const [action] = await Action.findOrCreate({
      where: { key },
      defaults: { menuId: menu.id, key, name: key, sorting: 1, status: true },
    });
    await RoleActionGrant.findOrCreate({
      where: { roleId, actionId: action.id },
      defaults: { roleId, actionId: action.id, granted: true },
    });
  }
}
