import type { Migration } from "../migrate";

/**
 * The self-service "Demo Access" feature is removed (module, model, routes,
 * menu and `demo.*` actions). This drops its table and enum types and the
 * catalog rows that pointed at it.
 *
 * Organizations and users a demo workspace provisioned are deliberately left
 * alone: they are ordinary rows now, and deleting organizations from a
 * migration is never safe (every tenant-scoped table hangs off them).
 */
export const up: Migration = async ({ context: q }) => {
  await q.sequelize.transaction(async (transaction) => {
    const run = (sql: string) => q.sequelize.query(sql, { transaction });
    await run("DROP TABLE IF EXISTS demo_tenants");
    await run("DROP TYPE IF EXISTS enum_demo_tenants_approval");
    await run("DROP TYPE IF EXISTS enum_demo_tenants_access_status");
    await run("DROP TYPE IF EXISTS enum_demo_tenants_seed_status");
    await run("DELETE FROM role_action_grants WHERE action_id IN (SELECT id FROM actions WHERE key LIKE 'demo.%')");
    await run("DELETE FROM actions WHERE key LIKE 'demo.%'");
    await run(
      "DELETE FROM role_menu_grants WHERE menu_id IN (SELECT id FROM menus WHERE route = '/demo-access')",
    );
    await run("DELETE FROM menus WHERE route = '/demo-access'");
  });
};

/**
 * No-op by design: the feature's code is gone, so recreating an empty table,
 * its actions or its menu would only resurrect dead catalog entries. The data
 * that was dropped (demo request rows and their temporary credentials) is not
 * meant to be restored.
 */
export const down: Migration = async () => {
  /* no-op */
};
