import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { sequelize } from "../sequelize";

export type TenantAcquisition = "Direct" | "Partner";
export type TenantStatus = "Draft" | "Pending Activation" | "Active" | "Suspended" | "Inactive";

export interface TenantAuditEntry {
  ts: string;
  msg: string;
}

/** Commercial/onboarding extension of a Tenant organization (decision R2). 1:1 via orgId. */
export class TenantProfile extends Model<
  InferAttributes<TenantProfile>,
  InferCreationAttributes<TenantProfile>
> {
  declare id: CreationOptional<string>;
  declare orgId: string;
  declare acquisition: CreationOptional<TenantAcquisition>;
  declare partnerOrgId: string | null;
  declare billingOwner: string | null;
  declare status: CreationOptional<TenantStatus>;
  declare subscriptionSummary: Record<string, unknown> | null;
  declare audit: CreationOptional<TenantAuditEntry[]>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

TenantProfile.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: false, unique: true, field: "org_id" },
    acquisition: { type: DataTypes.ENUM("Direct", "Partner"), allowNull: false, defaultValue: "Direct" },
    partnerOrgId: { type: DataTypes.UUID, allowNull: true, field: "partner_org_id" },
    billingOwner: { type: DataTypes.STRING, allowNull: true, field: "billing_owner" },
    status: {
      type: DataTypes.ENUM("Draft", "Pending Activation", "Active", "Suspended", "Inactive"),
      allowNull: false, defaultValue: "Draft",
    },
    subscriptionSummary: { type: DataTypes.JSONB, allowNull: true, field: "subscription_summary" },
    audit: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "tenant_profiles", underscored: true },
);
