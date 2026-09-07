import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { sequelize } from "../sequelize";

/**
 * OD user-status vocabulary. `acSave` (js/core.js:5226) tests membership against
 * exactly ['Pending Activation','Active','Suspended'] and the Team filter offers
 * the same three (js/core.js:4936); 'Deleted' is the soft-delete marker the list
 * filters out (js/core.js:4945). There is no 'Inactive' user state.
 */
export type UserStatus = "Pending Activation" | "Active" | "Suspended" | "Deleted";

/** Per-user permission mode (Administrators only); null for fixed-module role groups. */
export type PermissionMode = "Full Access" | "Custom Access";

export class User extends Model<InferAttributes<User>, InferCreationAttributes<User>> {
  declare id: CreationOptional<string>;
  /**
   * OD `db.users[].id` — the short, human-readable identifier the Team
   * Management "User ID" column shows ('axia1', 'EU-9001', 'idtu13';
   * js/modules.js:4480 and :5527). The primary key here is a UUID, so the OD
   * identity is carried alongside it. Null on rows created before it existed.
   */
  declare code: CreationOptional<string | null>;
  declare orgId: string;
  declare tenantId: string | null;
  declare fullName: string;
  declare username: string;
  declare email: string;
  declare passwordHash: string | null;
  declare status: UserStatus;
  declare position: string | null;
  declare phone: string | null;
  declare photo: string | null;
  declare workUnit: string | null;
  declare lastLogin: Date | null;
  declare activationToken: string | null;
  declare resetToken: string | null;
  declare resetExpires: Date | null;
  // AXIA Team Management additions (Phase 2). `system` protects seeded users from
  // delete/edit-lock; permissionMode/permissions are descriptive UI metadata for
  // the permission grid (effective access stays role-grant driven). CreationOptional
  // so existing User.create(...) call sites need not pass them.
  declare system: CreationOptional<boolean>;
  /**
   * OD `users[].superAdmin` (js/core.js:151) — a per-USER boolean, not a role.
   * The role group stays one of the four `ROLE_GROUPS` strings; super-admin is
   * an extra flag on top of it, so the platform owner is an Administrator who
   * also carries this, never a member of a fifth role group.
   */
  declare superAdmin: CreationOptional<boolean>;
  declare permissionMode: CreationOptional<PermissionMode | null>;
  declare permissions: CreationOptional<string[] | null>;
  // OD tenant-team member fields (migration 0047): site membership, personnel
  // category, and the per-member business-process assignment (`tmBpForm`).
  declare siteId: CreationOptional<string | null>;
  declare personnelType: CreationOptional<string | null>;
  declare processIds: CreationOptional<string[]>;
  declare orgUnitId: CreationOptional<string | null>;
  declare empLevel: CreationOptional<string | null>;
  /** OD `users[].department` — free-text org department label (SOF-58 §1). */
  declare department: CreationOptional<string | null>;
  /** OD `users[].provisioned` — account provisioning status (SOF-58 §1). */
  declare provisioned: CreationOptional<boolean>;
  // Member-level access axes (SOF-84, split out of SOF-74) — independent of the
  // Service Provider grid above (`permissionMode`/`permissions`). Mirrors OD
  // `acSave` (js/core.js:5210-5240): Enterprise system-of-record access, and
  // per-business-unit membership/access/perms.
  declare entAccess: CreationOptional<boolean>;
  declare entPerms: CreationOptional<string[]>;
  declare units: CreationOptional<string[]>;
  declare unitAccess: CreationOptional<Record<string, boolean>>;
  declare unitPerms: CreationOptional<Record<string, string[]>>;
  // Per-menu grant axes written by OD `acSave` (js/core.js:5216-5242). `navPerms`
  // is the granted Service Provider MENU key set (acAllKeys() members), the axis
  // `permissions` above is only the derived module list (`acNavToModules`).
  // The three *Actions maps hold the per-menu action verbs (ARCH_ACTIONS members,
  // always including 'view'); shapes per the OD persisted record:
  //   navActions  {menuKey: action[]}                 js/core.js:5223
  //   entActions  {entKey: action[]}                  js/core.js:5232
  //   unitActions {unitKey: {menuKey: action[]}}      js/core.js:5242
  declare navPerms: CreationOptional<string[]>;
  declare navActions: CreationOptional<Record<string, string[]>>;
  declare entActions: CreationOptional<Record<string, string[]>>;
  declare unitActions: CreationOptional<Record<string, Record<string, string[]>>>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  /**
   * Exclude credential-bearing fields from any JSON serialization (API
   * responses, logs). passwordHash and the activation/reset tokens authorize
   * account access, so they must never leave the server. This applies to all
   * paths that serialize a User via res.json() (create, list, setStatus).
   */
  toJSON(): Record<string, unknown> {
    const values = { ...super.toJSON() } as Record<string, unknown>;
    delete values.passwordHash;
    delete values.activationToken;
    delete values.resetToken;
    delete values.resetExpires;
    return values;
  }
}

User.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    code: { type: DataTypes.STRING, allowNull: true },
    orgId: { type: DataTypes.UUID, allowNull: false, field: "org_id" },
    tenantId: { type: DataTypes.UUID, allowNull: true, field: "tenant_id" },
    fullName: { type: DataTypes.STRING, allowNull: false, field: "full_name" },
    username: { type: DataTypes.STRING, allowNull: false, unique: true },
    email: { type: DataTypes.STRING, allowNull: false, unique: true },
    passwordHash: { type: DataTypes.STRING, allowNull: true, field: "password_hash" },
    status: {
      type: DataTypes.ENUM("Pending Activation", "Active", "Suspended", "Deleted"),
      allowNull: false,
      defaultValue: "Pending Activation",
    },
    position: { type: DataTypes.STRING, allowNull: true },
    phone: { type: DataTypes.STRING, allowNull: true },
    photo: { type: DataTypes.TEXT, allowNull: true },
    workUnit: { type: DataTypes.STRING, allowNull: true, field: "work_unit" },
    lastLogin: { type: DataTypes.DATE, allowNull: true, field: "last_login" },
    activationToken: { type: DataTypes.STRING, allowNull: true, field: "activation_token" },
    resetToken: { type: DataTypes.STRING, allowNull: true, field: "reset_token" },
    resetExpires: { type: DataTypes.DATE, allowNull: true, field: "reset_expires" },
    system: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    superAdmin: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: "super_admin" },
    permissionMode: { type: DataTypes.STRING, allowNull: true, field: "permission_mode" },
    permissions: { type: DataTypes.JSONB, allowNull: true, defaultValue: [] },
    siteId: { type: DataTypes.UUID, allowNull: true, field: "site_id" },
    personnelType: { type: DataTypes.STRING, allowNull: true, field: "personnel_type" },
    processIds: { type: DataTypes.JSONB, allowNull: false, defaultValue: [], field: "process_ids" },
    orgUnitId: { type: DataTypes.UUID, allowNull: true, field: "org_unit_id" },
    empLevel: { type: DataTypes.STRING, allowNull: true, field: "emp_level" },
    department: { type: DataTypes.STRING, allowNull: true },
    provisioned: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    entAccess: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: "ent_access" },
    entPerms: { type: DataTypes.JSONB, allowNull: false, defaultValue: [], field: "ent_perms" },
    units: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    unitAccess: { type: DataTypes.JSONB, allowNull: false, defaultValue: {}, field: "unit_access" },
    unitPerms: { type: DataTypes.JSONB, allowNull: false, defaultValue: {}, field: "unit_perms" },
    navPerms: { type: DataTypes.JSONB, allowNull: false, defaultValue: [], field: "nav_perms" },
    navActions: { type: DataTypes.JSONB, allowNull: false, defaultValue: {}, field: "nav_actions" },
    entActions: { type: DataTypes.JSONB, allowNull: false, defaultValue: {}, field: "ent_actions" },
    unitActions: { type: DataTypes.JSONB, allowNull: false, defaultValue: {}, field: "unit_actions" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "users", underscored: true },
);
