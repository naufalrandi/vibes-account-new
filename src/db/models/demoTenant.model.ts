import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { sequelize } from "../sequelize";

export type DemoApproval = "Pending" | "Approved" | "Rejected";
// accessStatus is null until the workspace is generated, then follows the lifecycle.
export type DemoAccessStatus = "Active" | "Expired" | "Disabled" | "Deleted" | "Archived";
export type DemoSeedStatus = "Pending" | "Seeded";

/**
 * A time-boxed, isolated demo workspace requested from the public landing page
 * and managed by the Service Provider. Access auto-expires; expired workspaces
 * are archived after a retention window.
 */
export class DemoTenant extends Model<
  InferAttributes<DemoTenant>,
  InferCreationAttributes<DemoTenant>
> {
  declare id: CreationOptional<string>;
  declare code: string;
  // Requester / organization details captured on the landing page.
  declare org: string;
  declare name: string;
  declare email: string;
  declare title: string | null;
  declare country: string | null;
  declare module: string;
  declare modules: CreationOptional<string[]>;
  declare intendedUse: string | null;
  // Provisioned demo identity (issued when the workspace is generated).
  declare tenantId: string;
  declare userId: string;
  declare username: string;
  declare tempPassword: string;
  declare role: CreationOptional<string>;
  // Real Organization/User rows created by generateDemoTenant() (null until
  // generated). tenantId/userId above stay the display codes (DEMO-xxx/DU-xxx,
  // asserted by existing tests) — these are the actual FKs the real /v1/auth/login
  // flow authenticates against.
  declare provisionedOrgId: string | null;
  declare provisionedUserId: string | null;
  // Lifecycle.
  declare approval: CreationOptional<DemoApproval>;
  declare accessStatus: DemoAccessStatus | null;
  declare seedStatus: CreationOptional<DemoSeedStatus>;
  declare validityHours: CreationOptional<number>;
  declare expiresAt: Date | null;
  declare lastLogin: Date | null;
  declare deletedAt: Date | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

DemoTenant.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    code: { type: DataTypes.STRING, allowNull: false, unique: true },
    org: { type: DataTypes.STRING, allowNull: false },
    name: { type: DataTypes.STRING, allowNull: false },
    email: { type: DataTypes.STRING, allowNull: false },
    title: { type: DataTypes.STRING, allowNull: true },
    country: { type: DataTypes.STRING, allowNull: true },
    module: { type: DataTypes.STRING, allowNull: false },
    modules: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    intendedUse: { type: DataTypes.TEXT, allowNull: true, field: "intended_use" },
    tenantId: { type: DataTypes.STRING, allowNull: false, field: "tenant_id" },
    userId: { type: DataTypes.STRING, allowNull: false, field: "user_id" },
    username: { type: DataTypes.STRING, allowNull: false },
    tempPassword: { type: DataTypes.STRING, allowNull: false, field: "temp_password" },
    role: { type: DataTypes.STRING, allowNull: false, defaultValue: "Demo Tenant Admin" },
    provisionedOrgId: { type: DataTypes.UUID, allowNull: true, field: "provisioned_org_id" },
    provisionedUserId: { type: DataTypes.UUID, allowNull: true, field: "provisioned_user_id" },
    approval: { type: DataTypes.ENUM("Pending", "Approved", "Rejected"), allowNull: false, defaultValue: "Pending" },
    accessStatus: {
      type: DataTypes.ENUM("Active", "Expired", "Disabled", "Deleted", "Archived"),
      allowNull: true, field: "access_status",
    },
    seedStatus: {
      type: DataTypes.ENUM("Pending", "Seeded"),
      allowNull: false, defaultValue: "Pending", field: "seed_status",
    },
    validityHours: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 48, field: "validity_hours" },
    expiresAt: { type: DataTypes.DATE, allowNull: true, field: "expires_at" },
    lastLogin: { type: DataTypes.DATE, allowNull: true, field: "last_login" },
    deletedAt: { type: DataTypes.DATE, allowNull: true, field: "deleted_at" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "demo_tenants", underscored: true },
);
