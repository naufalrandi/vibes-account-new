// `sequelize` and the model classes are imported lazily inside each helper so
// this module loads cleanly even before the models module exists (it lands in a
// later milestone). Tests that call these helpers run alongside the models, so
// the dynamic imports always resolve by the time the helpers are invoked.

/** Truncate all tables between tests, preserving structure. */
export async function resetDb(): Promise<void> {
  const { sequelize } = await import("../src/db/sequelize");
  await sequelize.query(
    'TRUNCATE TABLE "reference_countries","reference_sector_frameworks","reference_education_fields","reference_industry_sectors","reference_education_levels","element_assessment_answers","fwrc","record_events","role_assignments","role_templates","work_units","demo_tenants","ip_requirements","ip_parties","ms_scopes","scope_datasets","approval_records","approval_pool_members","approval_module_map","approval_schemes","approval_settings","competence_practical_attempts","competence_exam_attempts","competence_practical_instruments","competence_exam_instruments","competence_gaps","competence_assessments","competence_assignments","competence_roles","ia_settings","ia_reports","ia_findings","ia_sessions","ia_plans","ia_programs","competence_training","competence_skills","competence_education","notifications","kb_articles","testing_services","implementation_records","gaps","assessment_answers","assessments","framework_groups","framework_elements","framework_requirements","requirement_criteria","element_requirement_xref","conformance_questions","conformance_responses","plans","accounts","profiles","organization_frameworks","frameworks","framework_families","framework_types","refresh_tokens","login_history","audit_logs","registration_requests","subscriptions","role_action_grants","role_menu_grants","user_roles","actions","menus","users","roles","organizations" RESTART IDENTITY CASCADE',
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

/**
 * Populate the full action catalog the way the production seeder does.
 * `grantActions` only creates the keys it is asked for, so any code that grants
 * "everything" by iterating the Action table (e.g. demo-workspace provisioning)
 * sees an empty catalog in tests unless this has run.
 */
export async function seedActionCatalog(): Promise<void> {
  const { Menu, Action } = await import("../src/db/models");
  const { ACTIONS } = await import("../src/modules/iam/actions.catalog");
  const [menu] = await Menu.findOrCreate({
    where: { name: "TestMenu", parentId: null },
    defaults: { parentId: null, name: "TestMenu", heading: null, route: "/test", routeSeo: "test", icon: null, sorting: 1, status: true },
  });
  for (const key of Object.values(ACTIONS)) {
    await Action.findOrCreate({
      where: { key },
      defaults: { menuId: menu.id, key, name: key, sorting: 1, status: true },
    });
  }
}
