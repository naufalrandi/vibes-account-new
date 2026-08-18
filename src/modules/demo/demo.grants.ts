import { Op, type Transaction } from "sequelize";
import { Action, Menu, RoleActionGrant, RoleMenuGrant } from "../../db/models";
import { ACTIONS } from "../iam/actions.catalog";

/**
 * Server-side demo module allowlist (P0-12).
 *
 * A demo identity used to be provisioned with grantEverything; the approved
 * `DemoTenant.modules` list was consulted only by the browser
 * (fe-vibes-new lib/nav/navConfig.ts `filterForDemoSession` / DemoRouteGuard),
 * so any demo admin could call every namespace the API exposes. This module is
 * the server half of that contract: at provisioning the demo role is granted
 * only the actions its approved modules imply, so requireAction() rejects
 * everything else without any demo-specific middleware.
 *
 * The module matchers below are 1:1 mirrors of the FE's free-text matching
 * (navConfig.ts `demoAllowsFW`/`demoAllowsTesting`/`demoAllowsCalibration`,
 * itself a port of the OD prototype) — keep both sides in lockstep so the nav
 * a demo user sees and the API surface they hold grants for never diverge.
 */

/**
 * OD `demoAllowsFW` — framework/gap modules ("Framework Management",
 * "Not sure yet", …). "Assessment & Gap Analysis" is a `DEMO_MODULES` option
 * (fe-vibes-new `DemoModals.tsx`) with no OD-native counterpart — OD's demo
 * gating (index.html:4826-4836) keys on framework-implementation entitlement,
 * so it belongs in this same matcher set (mirrored in
 * `lib/nav/navConfig.ts`'s `demoAllowsFW`): a requester choosing it was
 * previously falling through to CORE-only grants.
 */
export function demoAllowsFrameworks(modules: string[]): boolean {
  return modules.some((m) => /framework/i.test(m) || /not sure/i.test(m) || /assessment/i.test(m));
}

/** OD `demoAllowsTesting` — "Testing Services", "Laboratory Services", bundles. */
export function demoAllowsTesting(modules: string[]): boolean {
  return modules.some((m) => /testing|bundle|laboratory/i.test(m));
}

/** OD `demoAllowsCalibration` — "Calibration Services", "Laboratory Services", bundles. */
export function demoAllowsCalibration(modules: string[]): boolean {
  return modules.some((m) => /calibration|bundle|laboratory/i.test(m));
}

/**
 * Granted to every demo identity regardless of module selection — the demo
 * shell itself: the Demo Home dashboard (audit feed), the KB/ticket support
 * surfaces the OD route guard always exempts, and the framework-assignment
 * read the AppShell issues on every Tenant boot for nav tier gating.
 */
const CORE_ACTION_KEYS: string[] = [
  ACTIONS.KB_READ,
  ACTIONS.TICKET_READ,
  ACTIONS.TICKET_CREATE,
  ACTIONS.TICKET_REPLY,
  ACTIONS.AUDIT_READ, // /member/dashboard renders the org-scoped audit feed
  ACTIONS.FRAMEWORK_ASSIGNMENT_READ, // AppShell listFrameworkAssignments()
];

/**
 * Framework-implementation modules — everything reachable through the demo
 * nav's Workspace + Basic + Extensions tiers (`filterForDemoSession`):
 * gap assessment, the ISO clause registers (/implementation/*), interested
 * parties, MS scope, competence, internal audit, plus the supporting reads
 * those pages issue (approval-governed record submission, work-unit/user
 * pickers on the internal-audit planner).
 */
const FRAMEWORK_ACTION_KEYS: string[] = [
  ACTIONS.ASSESSMENT_RUN_READ,
  ACTIONS.ASSESSMENT_RUN_MANAGE,
  ACTIONS.MS_READ,
  ACTIONS.MS_MANAGE,
  ACTIONS.IP_READ,
  ACTIONS.IP_MANAGE,
  ACTIONS.SCOPE_READ,
  ACTIONS.SCOPE_MANAGE,
  ACTIONS.COMPETENCE_READ,
  ACTIONS.COMPETENCE_MANAGE,
  ACTIONS.IAUDIT_READ,
  ACTIONS.IAUDIT_MANAGE,
  ACTIONS.APPROVAL_READ,
  ACTIONS.APPROVAL_APPROVE,
  ACTIONS.WORKUNIT_READ,
  ACTIONS.USER_READ,
];

/** Laboratory modules (testing and/or calibration) — the LIMS screens. */
const LAB_ACTION_KEYS: string[] = [ACTIONS.LIMS_READ, ACTIONS.LIMS_MANAGE];

/** Menus that carry no actions of their own but must always be granted. */
const ALWAYS_MENU_ROUTES = ["/dashboard"];

/** The exact action-key allowlist a demo workspace's modules imply. */
export function demoActionKeysForModules(modules: string[]): string[] {
  const keys = new Set<string>(CORE_ACTION_KEYS);
  if (demoAllowsFrameworks(modules)) FRAMEWORK_ACTION_KEYS.forEach((k) => keys.add(k));
  if (demoAllowsTesting(modules) || demoAllowsCalibration(modules)) LAB_ACTION_KEYS.forEach((k) => keys.add(k));
  return [...keys];
}

/**
 * Set a demo role's grants to exactly what its approved modules imply — a full
 * sync, not an additive grant: existing rows are wiped first, so re-generating
 * a workspace provisioned under the old grant-everything behaviour clamps it
 * down to the allowlist. The role is created solely for this demo identity
 * (provisionRealDemoIdentity), so wiping is safe.
 *
 * Menu grants are derived from the granted actions (a menu is included when it
 * owns at least one granted action, plus the action-less Dashboard menu);
 * buildMenuForUser() auto-includes ancestors, so leaf grants suffice.
 */
export async function applyDemoGrants(roleId: string, modules: string[], tx?: Transaction): Promise<void> {
  const keys = demoActionKeysForModules(modules);
  const actions = await Action.findAll({ where: { key: { [Op.in]: keys } }, transaction: tx });
  const menuIds = new Set(actions.map((a) => a.menuId));
  const alwaysMenus = await Menu.findAll({ where: { route: { [Op.in]: ALWAYS_MENU_ROUTES } }, transaction: tx });
  alwaysMenus.forEach((m) => menuIds.add(m.id));

  await RoleActionGrant.destroy({ where: { roleId }, transaction: tx });
  await RoleMenuGrant.destroy({ where: { roleId }, transaction: tx });
  await RoleActionGrant.bulkCreate(
    actions.map((a) => ({ roleId, actionId: a.id, granted: true })),
    { transaction: tx },
  );
  await RoleMenuGrant.bulkCreate(
    [...menuIds].map((menuId) => ({ roleId, menuId, granted: true })),
    { transaction: tx },
  );
}
