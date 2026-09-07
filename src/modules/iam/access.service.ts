import { Action, Menu, Role, RoleActionGrant, RoleMenuGrant, User } from "../../db/models";
import { menuActions, type PermAction } from "./actions.catalog";

export interface EffectiveAccess {
  isSuperAdmin: boolean;
  actionKeys: string[];
  menuIds: string[];
  roleNames: string[];
}

/**
 * Resolve a user's effective access = union of grants across all their roles,
 * clamped by the two per-user access axes OD itself evaluates at run time.
 *
 * OD carries no Role/Menu/Action/Grant entity and no request-time authorization
 * (js/core.js:4239 "Access gate (prototype-stage; full permission matrix is a
 * later sweep)"), so the role-grant stack below is an addition this port makes
 * and keeps: it is the only default-deny boundary the API has. What OD *does*
 * decide per user, it decides here — `u.superAdmin` and `u.provisioned` are read
 * on every request instead of being write-only columns of the Access
 * Configuration screen.
 */
export async function getEffectiveAccess(userId: string): Promise<EffectiveAccess> {
  const user = await User.findByPk(userId, { include: [Role] });
  const roles = (user?.get("Roles") as Role[]) ?? [];
  // OD models super-admin as the per-USER boolean `u.superAdmin` (js/core.js:151),
  // read by `acInit` as `const sa=!!u.superAdmin` (js/core.js:5081) and expanded by
  // `acSave`'s `sa` branch (js/core.js:5233-5237) into every menu key and every
  // action. `user.service.ts` already resolves `isSuper` from that column
  // (user.service.ts:401) — authorization has to agree with the screen that locks it.
  const isSuperAdmin = !!user?.superAdmin || roles.some((r) => r.isSuperAdmin);
  const roleIds = roles.map((r) => r.id);
  const roleNames = roles.map((r) => r.name);
  // OD `tmProvisioned` (js/core.js:4913-4917): `u.provisioned===false` is decided
  // first and unconditionally — the member reads "No access" (`tmAccessStatus`,
  // js/core.js:4918) and `acInit` grants nothing (`granted = sa||tmProvisioned(u)`,
  // js/core.js:5084). The column is NOT NULL here, so the two later branches
  // (`permissions.length`, `roleGroup`) are unreachable: they only run when
  // `provisioned` is undefined. Revoking Service Provider platform access
  // (js/core.js:5216) must therefore take effect at request time and not merely
  // through the UserRole rows `updateUser` clears alongside it — `assignRole`
  // re-attaches a role directly.
  if (!isSuperAdmin && user && !user.provisioned) {
    return { isSuperAdmin: false, actionKeys: [], menuIds: [], roleNames };
  }
  if (roleIds.length === 0) return { isSuperAdmin, actionKeys: [], menuIds: [], roleNames };

  const actionGrants = await RoleActionGrant.findAll({
    where: { roleId: roleIds, granted: true },
    include: [Action],
  });
  const actionKeys = [...new Set(actionGrants.map((g) => (g.get("Action") as Action).key))];

  const menuGrants = await RoleMenuGrant.findAll({ where: { roleId: roleIds, granted: true } });
  const menuIds = [...new Set(menuGrants.map((g) => g.menuId))];

  return { isSuperAdmin, actionKeys, menuIds, roleNames };
}

export async function getUserRoleNames(userId: string): Promise<string[]> {
  const user = await User.findByPk(userId, { include: [Role] });
  return ((user?.get("Roles") as Role[]) ?? []).map((r) => r.name);
}

export async function isUserSuperAdmin(userId: string): Promise<boolean> {
  const user = await User.findByPk(userId, { include: [Role] });
  // Same two sources as `getEffectiveAccess`: OD's per-user `u.superAdmin`
  // (js/core.js:151) first, the role relation for principals seeded the old way.
  return !!user?.superAdmin || ((user?.get("Roles") as Role[]) ?? []).some((r) => r.isSuperAdmin);
}

export interface MenuNode {
  id: string;
  name: string;
  heading: string | null;
  route: string | null;
  routeSeo: string | null;
  icon: string | null;
  sorting: number;
  actions: { key: string; name: string; granted: boolean }[];
  children: MenuNode[];
}

/**
 * Build the menu tree visible to a user (super-admin sees all), each menu's actions
 * flagged granted/not, plus a flat `access` map of granted action keys.
 */
export async function buildMenuForUser(userId: string): Promise<{ menu: MenuNode[]; access: Record<string, boolean> }> {
  const { isSuperAdmin, actionKeys, menuIds } = await getEffectiveAccess(userId);
  const grantedActions = new Set(actionKeys);
  const grantedMenus = new Set(menuIds);

  const menus = await Menu.findAll({ where: { status: true }, order: [["sorting", "ASC"]] });
  const actions = await Action.findAll({ where: { status: true }, order: [["sorting", "ASC"]] });

  const byId = new Map(menus.map((m) => [m.id, m]));
  // A menu is included if granted (or super-admin) OR is an ancestor of a granted menu.
  const included = new Set<string>();
  if (isSuperAdmin) {
    menus.forEach((m) => included.add(m.id));
  } else {
    for (const m of menus) {
      if (!grantedMenus.has(m.id)) continue;
      let cur: Menu | undefined = m;
      while (cur) {
        included.add(cur.id);
        cur = cur.parentId ? byId.get(cur.parentId) : undefined;
      }
    }
  }

  const actionsByMenu = new Map<string, Action[]>();
  for (const a of actions) {
    const list = actionsByMenu.get(a.menuId) ?? [];
    list.push(a);
    actionsByMenu.set(a.menuId, list);
  }

  const access: Record<string, boolean> = {};
  for (const a of actions) {
    if (isSuperAdmin || grantedActions.has(a.key)) access[a.key] = true;
  }

  const childrenOf = (parentId: string | null): MenuNode[] =>
    menus
      .filter((m) => m.parentId === parentId && included.has(m.id))
      .map((m) => ({
        id: m.id,
        name: m.name,
        heading: m.heading,
        route: m.route,
        routeSeo: m.routeSeo,
        icon: m.icon,
        sorting: m.sorting,
        actions: (actionsByMenu.get(m.id) ?? []).map((a) => ({
          key: a.key,
          name: a.name,
          granted: isSuperAdmin || grantedActions.has(a.key),
        })),
        children: childrenOf(m.id),
      }));

  return { menu: childrenOf(null), access };
}

/* =========================================================================
 * OD permission levels — Access Configuration screen (js/core.js:5063-5069).
 * A level is a shorthand over the per-action checkboxes: it names a whitelist
 * of verbs, and `levelActions` intersects that whitelist with the actions the
 * menu's archetype actually declares (`menuActions`).
 * ========================================================================= */

/** OD `PERM_LEVELS` (js/core.js:5063). */
export const PERM_LEVELS = ["View", "Edit", "Approve", "Manage"] as const;
export type PermLevel = (typeof PERM_LEVELS)[number];

/**
 * OD `levelActions(level,k)` (js/core.js:5064-5069). `Manage` is every action
 * the archetype declares; the others intersect a fixed whitelist with it.
 *
 * Ported verbatim including the fall-through: the OD ternary has no explicit
 * 'Approve' arm, so ANY level string that is not 'View', 'Edit' or 'Manage'
 * resolves to the Approve whitelist.
 */
export function levelActions(level: string, menuKey: string): PermAction[] {
  const appl = menuActions(menuKey);
  if (level === "Manage") return appl.slice();
  const w: readonly PermAction[] =
    level === "View"
      ? ["view", "export"]
      : level === "Edit"
        ? ["view", "export", "create", "edit"]
        : ["view", "export", "create", "edit", "approve", "publish"];
  return appl.filter((a) => w.indexOf(a) >= 0);
}

/**
 * OD `acDefaultLevel(role)` (js/core.js:5070) — the level a grant falls back to
 * when no explicit action set was supplied for it.
 */
export function acDefaultLevel(role: string | null): PermLevel {
  return role === "Administrator" ? "Manage" : role === "Basic User" ? "View" : "Edit";
}
