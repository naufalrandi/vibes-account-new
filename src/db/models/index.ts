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
import { FrameworkType } from "./frameworkType.model";
import { FrameworkFamily } from "./frameworkFamily.model";
import { Framework } from "./framework.model";
import { OrganizationFramework } from "./organizationFramework.model";
import { Profile } from "./profile.model";
import { Account } from "./account.model";

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

  // A framework type owns many framework families; a type with families cannot
  // be deleted (enforced in the service and by an ON DELETE RESTRICT FK).
  FrameworkType.hasMany(FrameworkFamily, { foreignKey: "frameworkTypeId" });
  FrameworkFamily.belongsTo(FrameworkType, { foreignKey: "frameworkTypeId" });

  // A framework family owns many frameworks; a family with frameworks cannot be
  // deleted (enforced in the service and by an ON DELETE RESTRICT FK).
  FrameworkFamily.hasMany(Framework, { foreignKey: "familyId" });
  Framework.belongsTo(FrameworkFamily, { foreignKey: "familyId" });

  // An organization may subscribe to many catalog frameworks; each subscription
  // row is unique per (org, framework). Deleting either side cascades the link.
  Organization.hasMany(OrganizationFramework, { foreignKey: "orgId" });
  OrganizationFramework.belongsTo(Organization, { foreignKey: "orgId" });
  Framework.hasMany(OrganizationFramework, { foreignKey: "frameworkId" });
  OrganizationFramework.belongsTo(Framework, { foreignKey: "frameworkId" });

  // Organization-scoped User Management entities. Each row belongs to one
  // organization; deleting the org cascades its profiles/accounts away (FK).
  Organization.hasMany(Profile, { foreignKey: "orgId" });
  Profile.belongsTo(Organization, { foreignKey: "orgId" });
  Organization.hasMany(Account, { foreignKey: "orgId" });
  Account.belongsTo(Organization, { foreignKey: "orgId" });

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
  FrameworkType,
  FrameworkFamily,
  Framework,
  OrganizationFramework,
  Profile,
  Account,
};
