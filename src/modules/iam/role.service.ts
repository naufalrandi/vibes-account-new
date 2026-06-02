import { Action, Menu, RoleActionGrant, RoleMenuGrant } from "../../db/models";
import { writeAudit } from "../audit/audit.service";
import { NotFoundError } from "../../lib/errors";
import { Role } from "../../db/models";

export interface RoleGrants {
  menuIds: string[];
  actionKeys: string[];
}

/** Current granted menu ids + action keys for a role. */
export async function getRoleGrants(roleId: string): Promise<RoleGrants> {
  const role = await Role.findByPk(roleId);
  if (!role) throw new NotFoundError("Role not found");
  const menuGrants = await RoleMenuGrant.findAll({ where: { roleId, granted: true } });
  const actionGrants = await RoleActionGrant.findAll({ where: { roleId, granted: true }, include: [Action] });
  return {
    menuIds: menuGrants.map((g) => g.menuId),
    actionKeys: actionGrants.map((g) => (g.get("Action") as Action).key),
  };
}

/** Replace a role's grants with exactly the given menus + action keys. */
export async function setRoleGrants(
  roleId: string,
  menuIds: string[],
  actionKeys: string[],
  actorUserId: string,
  ip: string | null,
): Promise<void> {
  const role = await Role.findByPk(roleId);
  if (!role) throw new NotFoundError("Role not found");

  await RoleMenuGrant.destroy({ where: { roleId } });
  await RoleActionGrant.destroy({ where: { roleId } });

  const menus = await Menu.findAll({ where: { id: menuIds } });
  for (const m of menus) {
    await RoleMenuGrant.create({ roleId, menuId: m.id, granted: true });
  }
  const actions = await Action.findAll({ where: { key: actionKeys } });
  for (const a of actions) {
    await RoleActionGrant.create({ roleId, actionId: a.id, granted: true });
  }
  await writeAudit({
    actorUserId,
    action: "role.grants.updated",
    entityType: "Role",
    entityId: roleId,
    sourceIp: ip,
    result: "Success",
    metadata: { menus: menus.length, actions: actions.length },
  });
}
