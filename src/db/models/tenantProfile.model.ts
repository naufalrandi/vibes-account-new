import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { sequelize } from "../sequelize";

export type TenantAcquisition = "Direct" | "Partner";
export type TenantStatus = "Draft" | "Pending Activation" | "Active" | "Suspended" | "Inactive";

export interface TenantAuditEntry {
  ts: string;
  msg: string;
}

/** One Subscription Timeline event (OD `timelineHtml`, index.html:7481). */
export interface TenantAgreementEvent {
  date: string;
  event: string;
}

/**
 * The tenant's Subscription Agreement document (OD sp-tenant Billing tab,
 * index.html:7436-7452). Stored as one JSONB column — strictly 1:1 with the
 * profile and always read whole. "Billing Owner" is derived from `acquisition`
 * at view time, never stored.
 */
export interface TenantAgreementInfo {
  number: string;
  name: string;
  version: string;
  status: string;
  subscriptionType: string;
  billingCycle: string;
  effectiveDate: string | null;
  expirationDate: string | null;
  currency: string;
  paymentDueDays: number | null;
  history: TenantAgreementEvent[];
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
  declare agreement: CreationOptional<TenantAgreementInfo | null>;
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
    agreement: { type: DataTypes.JSONB, allowNull: true },
    audit: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "tenant_profiles", underscored: true },
);
