import { type Transaction, type WhereOptions } from "sequelize";
import { Action, Menu, Organization, RoleActionGrant, RoleMenuGrant } from "../../db/models";
import { sequelize } from "../../db/sequelize";
import { writeAudit } from "../audit/audit.service";
import { ForbiddenError, NotFoundError } from "../../lib/errors";
import { Role } from "../../db/models";
import type { AuthContext } from "../../lib/scope";
import { canActOnRole, organizationScopeWhere, roleScopeWhere } from "../../lib/scope";
import { SP_ONLY_ACTIONS } from "./tenantGrants";

export interface RoleGrants {
  menuIds: string[];
  actionKeys: string[];
}

/** Org ids the actor may act within (self + managed tenants for distributors). */
async function scopedOrgIds(auth: AuthContext): Promise<string[]> {
  const where: WhereOptions = organizationScopeWhere(auth);
  const orgs = await Organization.findAll({ where, attributes: ["id"] });
  return orgs.map((o) => o.id);
}

/** Load a role and enforce that the actor may read/mutate it; throws otherwise. */
async function loadOwnedRole(auth: AuthContext, roleId: string, tx?: Transaction): Promise<Role> {
  const role = await Role.findByPk(roleId, { transaction: tx });
  if (!role) throw new NotFoundError("Role not found");
  let parentOrgId: string | null = null;
  if (role.orgId) {
    const org = await Organization.findByPk(role.orgId, { attributes: ["parentOrgId"], transaction: tx });
    parentOrgId = org?.parentOrgId ?? null;
  }
  if (!canActOnRole(auth, role.orgId, parentOrgId)) throw new ForbiddenError();
  return role;
}

/** A role belongs to the Service Owner org (a global role counts when SO-tiered). */
async function isServiceOwnerRole(role: Role, tx?: Transaction): Promise<boolean> {
  if (!role.orgId) return role.tierScope === "ServiceOwner";
  const org = await Organization.findByPk(role.orgId, { attributes: ["type"], transaction: tx });
  return org?.type === "ServiceOwner";
}

/** Roles visible to the actor. */
export async function listRoles(auth: AuthContext): Promise<Role[]> {
  const where: WhereOptions = roleScopeWhere(auth, await scopedOrgIds(auth));
  return Role.findAll({ where, order: [["name", "ASC"]] });
}

/** Current granted menu ids + action keys for a role the actor may read. */
export async function getRoleGrants(auth: AuthContext, roleId: string): Promise<RoleGrants> {
  await loadOwnedRole(auth, roleId);
  const menuGrants = await RoleMenuGrant.findAll({ where: { roleId, granted: true } });
  const actionGrants = await RoleActionGrant.findAll({ where: { roleId, granted: true }, include: [Action] });
  return {
    menuIds: menuGrants.map((g) => g.menuId),
    actionKeys: actionGrants.map((g) => (g.get("Action") as Action).key),
  };
}

/** Replace a role's grants with exactly the given menus + action keys. */
export async function setRoleGrants(
  auth: AuthContext,
  roleId: string,
  menuIds: string[],
  actionKeys: string[],
  actorUserId: string,
  ip: string | null,
): Promise<void> {
  await sequelize.transaction(async (tx) => {
    const role = await loadOwnedRole(auth, roleId, tx);
    // SP-only actions are gated to the Service Owner in the services themselves;
    // granting one to a Distributor/Tenant role is a pure over-grant (see
    // SP_ONLY_ACTIONS), so it is refused rather than silently stored.
    const spOnly = actionKeys.filter((k) => SP_ONLY_ACTIONS.includes(k));
    if (spOnly.length > 0 && !(await isServiceOwnerRole(role, tx))) {
      throw new ForbiddenError(`Service-Owner-only actions cannot be granted to this role: ${spOnly.join(", ")}`, "SP_ONLY_ACTION");
    }

    await RoleMenuGrant.destroy({ where: { roleId }, transaction: tx });
    await RoleActionGrant.destroy({ where: { roleId }, transaction: tx });

    const menus = await Menu.findAll({ where: { id: menuIds }, transaction: tx });
    for (const m of menus) {
      await RoleMenuGrant.create({ roleId, menuId: m.id, granted: true }, { transaction: tx });
    }
    const actions = await Action.findAll({ where: { key: actionKeys }, transaction: tx });
    for (const a of actions) {
      await RoleActionGrant.create({ roleId, actionId: a.id, granted: true }, { transaction: tx });
    }
    await writeAudit(
      {
        actorUserId,
        action: "role.grants.updated",
        entityType: "Role",
        entityId: roleId,
        sourceIp: ip,
        result: "Success",
        metadata: { menus: menus.length, actions: actions.length },
      },
      tx,
    );
  });
}
