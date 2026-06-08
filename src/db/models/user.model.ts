import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { sequelize } from "../sequelize";

export type UserStatus = "PendingActivation" | "Active" | "Suspended" | "Inactive" | "Deleted";

/** Per-user permission mode (Administrators only); null for fixed-module role groups. */
export type PermissionMode = "Full Access" | "Custom Access";

export class User extends Model<InferAttributes<User>, InferCreationAttributes<User>> {
  declare id: CreationOptional<string>;
  declare orgId: string;
  declare tenantId: string | null;
  declare fullName: string;
  declare username: string;
  declare email: string;
  declare passwordHash: string | null;
  declare status: UserStatus;
  declare position: string | null;
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
  declare permissionMode: CreationOptional<PermissionMode | null>;
  declare permissions: CreationOptional<string[] | null>;
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
    orgId: { type: DataTypes.UUID, allowNull: false, field: "org_id" },
    tenantId: { type: DataTypes.UUID, allowNull: true, field: "tenant_id" },
    fullName: { type: DataTypes.STRING, allowNull: false, field: "full_name" },
    username: { type: DataTypes.STRING, allowNull: false, unique: true },
    email: { type: DataTypes.STRING, allowNull: false, unique: true },
    passwordHash: { type: DataTypes.STRING, allowNull: true, field: "password_hash" },
    status: {
      type: DataTypes.ENUM("PendingActivation", "Active", "Suspended", "Inactive", "Deleted"),
      allowNull: false,
      defaultValue: "PendingActivation",
    },
    position: { type: DataTypes.STRING, allowNull: true },
    workUnit: { type: DataTypes.STRING, allowNull: true, field: "work_unit" },
    lastLogin: { type: DataTypes.DATE, allowNull: true, field: "last_login" },
    activationToken: { type: DataTypes.STRING, allowNull: true, field: "activation_token" },
    resetToken: { type: DataTypes.STRING, allowNull: true, field: "reset_token" },
    resetExpires: { type: DataTypes.DATE, allowNull: true, field: "reset_expires" },
    system: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    permissionMode: { type: DataTypes.STRING, allowNull: true, field: "permission_mode" },
    permissions: { type: DataTypes.JSONB, allowNull: true, defaultValue: [] },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "users", underscored: true },
);
