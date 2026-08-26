import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { sequelize } from "../sequelize";

export type TenantAcquisition = "Direct" | "Partner";
export type TenantStatus = "Draft" | "Pending Activation" | "Active" | "Suspended" | "Inactive";

export interface TenantAuditEntry {
  ts: string;
  msg: string;
}

/** One Subscription Timeline event (OD `timelineHtml`, app.html:10071). */
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

/** OD `tenants[].billing` (`core.js`) — a small display object, distinct from the
 * unused `subscriptionSummary` column and from `agreement` (the full Subscription
 * Agreement document). */
export interface TenantBillingInfo {
  plan: string;
  status: string;
}

/** One entry of a tenant's per-invoice revenue-share ledger under Partner
 * acquisition (OD `t.revenueShare = buildRevenueShare(inv, pct)`, `core.js`). */
export interface TenantRevenueShareEntry {
  invoiceId: string;
  amount: number;
  pct: number;
  share: number;
  date: string | null;
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
  /** OD `tenants[].admin` — the User row identifying the tenant admin, created at
   * tenant-creation time (mirrors `PartnerProfile.adminUserId`). */
  declare adminUserId: string | null;
  declare billing: CreationOptional<TenantBillingInfo | null>;
  declare revenueShare: CreationOptional<TenantRevenueShareEntry[]>;
  /** OD `apSelfApprovalAllowed` (`core.js:12411`) — defaults true unless explicitly disabled. */
  declare selfApprovalAllowed: CreationOptional<boolean>;
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
    adminUserId: { type: DataTypes.UUID, allowNull: true, field: "admin_user_id" },
    billing: { type: DataTypes.JSONB, allowNull: true, defaultValue: null },
    revenueShare: { type: DataTypes.JSONB, allowNull: true, defaultValue: [], field: "revenue_share" },
    selfApprovalAllowed: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: "self_approval_allowed" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "tenant_profiles", underscored: true },
);
