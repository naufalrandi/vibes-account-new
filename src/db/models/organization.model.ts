import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { sequelize } from "../sequelize";

export type OrgType = "ServiceOwner" | "Distributor" | "Tenant";
export type OrgStatus = "Draft" | "PendingApproval" | "Active" | "Suspended" | "Inactive";

/** Org branding configuration (logo/favicon assets + primary/secondary colors). */
export interface OrgBranding {
  logo: string;
  favicon: string;
  primary: string;
  secondary: string;
}

/** Org system defaults applied to generated records (currency/timezone/country/language). */
export interface OrgDefaults {
  currency: string;
  timezone: string;
  country: string;
  language: string;
}

// AXIA Partner (Commercial) lifecycle status + tier. Stored as STRING (mutable
// labels) to avoid Postgres enum-migration churn. Distributor orgs are partners.
export type PartnerStatus = "Draft" | "Pending Approval" | "Approved" | "Active" | "Suspended" | "Terminated";
export type PartnerTier = "Bronze" | "Silver" | "Gold";

/** A timestamped entry in a partner's audit trail. */
export interface PartnerAuditEntry {
  ts: string;
  msg: string;
}

export class Organization extends Model<InferAttributes<Organization>, InferCreationAttributes<Organization>> {
  declare id: CreationOptional<string>;
  declare name: string;
  declare code: string;
  declare type: OrgType;
  declare status: OrgStatus;
  declare parentOrgId: string | null;
  declare tenantId: string | null;
  declare email: string | null;
  declare phone: string | null;
  declare website: string | null;
  declare country: string | null;
  declare address: string | null;
  declare legalName: string | null;
  declare industry: string | null;
  declare contactName: string | null;
  declare contactEmail: string | null;
  declare contactPhone: string | null;
  // AXIA Organization Profile additions (Phase 2). CreationOptional so existing
  // Organization.create(...) call sites need not pass them.
  declare taxId: CreationOptional<string | null>;
  declare branding: CreationOptional<OrgBranding | null>;
  declare defaults: CreationOptional<OrgDefaults | null>;
  // AXIA Commercial (Phase 3) — partner lifecycle metadata on Distributor orgs.
  declare partnerStatus: CreationOptional<PartnerStatus | null>;
  declare partnerTier: CreationOptional<PartnerTier | null>;
  declare partnerCode: CreationOptional<string | null>;
  declare partnerAudit: CreationOptional<PartnerAuditEntry[] | null>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

Organization.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    name: { type: DataTypes.STRING, allowNull: false },
    code: { type: DataTypes.STRING, allowNull: false, unique: true },
    type: { type: DataTypes.ENUM("ServiceOwner", "Distributor", "Tenant"), allowNull: false },
    status: {
      type: DataTypes.ENUM("Draft", "PendingApproval", "Active", "Suspended", "Inactive"),
      allowNull: false,
      defaultValue: "Draft",
    },
    parentOrgId: { type: DataTypes.UUID, allowNull: true, field: "parent_org_id" },
    tenantId: { type: DataTypes.UUID, allowNull: true, field: "tenant_id" },
    email: { type: DataTypes.STRING, allowNull: true },
    phone: { type: DataTypes.STRING, allowNull: true },
    website: { type: DataTypes.STRING, allowNull: true },
    country: { type: DataTypes.STRING, allowNull: true },
    address: { type: DataTypes.STRING, allowNull: true },
    legalName: { type: DataTypes.STRING, allowNull: true, field: "legal_name" },
    industry: { type: DataTypes.STRING, allowNull: true },
    contactName: { type: DataTypes.STRING, allowNull: true, field: "contact_name" },
    contactEmail: { type: DataTypes.STRING, allowNull: true, field: "contact_email" },
    contactPhone: { type: DataTypes.STRING, allowNull: true, field: "contact_phone" },
    taxId: { type: DataTypes.STRING, allowNull: true, field: "tax_id" },
    branding: { type: DataTypes.JSONB, allowNull: true },
    defaults: { type: DataTypes.JSONB, allowNull: true },
    partnerStatus: { type: DataTypes.STRING, allowNull: true, field: "partner_status" },
    partnerTier: { type: DataTypes.STRING, allowNull: true, field: "partner_tier" },
    partnerCode: { type: DataTypes.STRING, allowNull: true, field: "partner_code" },
    partnerAudit: { type: DataTypes.JSONB, allowNull: true, defaultValue: [] },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "organizations", underscored: true },
);
