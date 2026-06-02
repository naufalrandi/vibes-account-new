import { Organization } from "./organization.model";
import { User } from "./user.model";
import { Role } from "./role.model";
import { Menu } from "./menu.model";
import { Action } from "./action.model";
import { UserRole } from "./userRole.model";
import { RoleMenuGrant } from "./roleMenuGrant.model";
import { RoleActionGrant } from "./roleActionGrant.model";
import { Subscription } from "./subscription.model";
import { RegistrationRequest } from "./registrationRequest.model";
import { AuditLog } from "./auditLog.model";
import { LoginHistory } from "./loginHistory.model";
import { RefreshToken } from "./refreshToken.model";

let initialized = false;

export function initModels(): void {
  if (initialized) return;
  Organization.hasMany(User, { foreignKey: "orgId" });
  User.belongsTo(Organization, { foreignKey: "orgId" });

  Organization.hasMany(Organization, { foreignKey: "parentOrgId", as: "children" });
  Organization.belongsTo(Organization, { foreignKey: "parentOrgId", as: "parent" });

  // A user may hold many roles; effective access is the union of their grants.
  User.belongsToMany(Role, { through: UserRole, foreignKey: "userId", otherKey: "roleId" });
  Role.belongsToMany(User, { through: UserRole, foreignKey: "roleId", otherKey: "userId" });

  // Menu tree (self-reference) + actions per menu.
  Menu.hasMany(Menu, { foreignKey: "parentId", as: "children" });
  Menu.belongsTo(Menu, { foreignKey: "parentId", as: "parent" });
  Menu.hasMany(Action, { foreignKey: "menuId" });
  Action.belongsTo(Menu, { foreignKey: "menuId" });

  // Role ↔ menu/action grant cells.
  Role.hasMany(RoleMenuGrant, { foreignKey: "roleId" });
  RoleMenuGrant.belongsTo(Role, { foreignKey: "roleId" });
  RoleMenuGrant.belongsTo(Menu, { foreignKey: "menuId" });
  Role.hasMany(RoleActionGrant, { foreignKey: "roleId" });
  RoleActionGrant.belongsTo(Role, { foreignKey: "roleId" });
  RoleActionGrant.belongsTo(Action, { foreignKey: "actionId" });

  Organization.hasOne(Subscription, { foreignKey: "orgId" });
  Subscription.belongsTo(Organization, { foreignKey: "orgId" });

  initialized = true;
}

export {
  Organization,
  User,
  Role,
  Menu,
  Action,
  UserRole,
  RoleMenuGrant,
  RoleActionGrant,
  Subscription,
  RegistrationRequest,
  AuditLog,
  LoginHistory,
  RefreshToken,
};
