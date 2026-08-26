import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { sequelize } from "../sequelize";
import type { TenantAgreementInfo } from "./tenantProfile.model";

export type PartnerTier = "Bronze" | "Silver" | "Gold";
export type PartnerStatus =
  | "Draft"
  | "Pending Approval"
  | "Approved"
  | "Active"
  | "Suspended"
  | "Terminated";

export interface PartnerAuditEntry {
  ts: string;
  msg: string;
}

/**
 * Commercial extension of a Distributor organization (decision R2). 1:1 with an
 * `organizations` row of type Distributor via `orgId`. Holds the partner code,
 * tier, lifecycle status, and a denormalized audit trail (newest-first) that the
 * partner detail "Audit" tab renders directly.
 */
export class PartnerProfile extends Model<
  InferAttributes<PartnerProfile>,
  InferCreationAttributes<PartnerProfile>
> {
  declare id: CreationOptional<string>;
  declare orgId: string;
  declare code: string;
  declare tier: PartnerTier | null;
  declare status: CreationOptional<PartnerStatus>;
  declare adminUserId: string | null;
  declare commercialSummary: Record<string, unknown> | null;
  declare audit: CreationOptional<PartnerAuditEntry[]>;
  /** OD `partners[].agreement` — same shape as `TenantProfile.agreement`, the
   * commercial partner's own Subscription/Partnership Agreement document. */
  declare agreement: CreationOptional<TenantAgreementInfo | null>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

PartnerProfile.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: false, unique: true, field: "org_id" },
    code: { type: DataTypes.STRING, allowNull: false, unique: true },
    tier: { type: DataTypes.ENUM("Bronze", "Silver", "Gold"), allowNull: true },
    status: {
      type: DataTypes.ENUM("Draft", "Pending Approval", "Approved", "Active", "Suspended", "Terminated"),
      allowNull: false,
      defaultValue: "Draft",
    },
    adminUserId: { type: DataTypes.UUID, allowNull: true, field: "admin_user_id" },
    commercialSummary: { type: DataTypes.JSONB, allowNull: true, field: "commercial_summary" },
    audit: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    agreement: { type: DataTypes.JSONB, allowNull: true, defaultValue: null },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "partner_profiles", underscored: true },
);
