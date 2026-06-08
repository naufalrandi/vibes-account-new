// `sequelize` and the model classes are imported lazily inside each helper so
// this module loads cleanly even before the models module exists (it lands in a
// later milestone). Tests that call these helpers run alongside the models, so
// the dynamic imports always resolve by the time the helpers are invoked.

/** Truncate all tables between tests, preserving structure. */
export async function resetDb(): Promise<void> {
  const { sequelize } = await import("../src/db/sequelize");
  await sequelize.query(
    // framework_groups is intentionally NOT truncated — the two fixed groups
    // (Standards / Regulations) are seeded by migration 0010 and persist for all tests.
    'TRUNCATE TABLE "business_records","implementation_records","notifications","tickets","assessment_response_criteria","assessment_responses","assessment_questions","assessment_criteria","kb_articles","framework_element_requirement_maps","framework_elements","framework_requirements","framework_assignments","invoices","plans","partner_agreements","agreement_templates","site_requests","sites","accounts","profiles","org_signatories","frameworks","refresh_tokens","login_history","audit_logs","registration_requests","subscriptions","role_action_grants","role_menu_grants","user_roles","actions","menus","users","roles","organizations" RESTART IDENTITY CASCADE',
  );
}

/**
 * Grant specific action keys to a role for tests: ensures a menu + the actions
 * exist, then creates granted RoleActionGrant rows. Use for non-super-admin roles.
 */
export async function grantActions(roleId: string, keys: string[]): Promise<void> {
  const { Menu, Action, RoleActionGrant } = await import("../src/db/models");
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
