import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { sequelize } from "../sequelize";
import type { TenantAuditEntry } from "./tenantProfile.model";

export type SiteRequestType = "Site Addition" | "Site Change" | "Site Closure";
export type SiteRequestStatus =
  | "Draft" | "Submitted" | "Under Review" | "Approved" | "Rejected" | "Cancelled";

export interface SiteRequestProposed {
  name?: string;
  siteType?: string;
  country?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  isPrimary?: boolean;
}

/** A controlled change to a tenant's sites (Addition / Change / Closure). */
export class SiteRequest extends Model<
  InferAttributes<SiteRequest>,
  InferCreationAttributes<SiteRequest>
> {
  declare id: CreationOptional<string>;
  declare orgId: string;
  declare code: string;
  declare type: SiteRequestType;
  declare siteId: string | null;
  declare requestedBy: CreationOptional<string>;
  declare proposed: CreationOptional<SiteRequestProposed>;
  declare reason: string | null;
  declare status: CreationOptional<SiteRequestStatus>;
  declare provisioned: CreationOptional<boolean>;
  declare provisionedSiteId: string | null;
  /** OD `siteRequests[].audit` — array of `{ts, msg}` entries, same shape as
   * `TenantProfile.audit`/`PartnerProfile.audit` (NOT the IA activity/comments triple). */
  declare audit: CreationOptional<TenantAuditEntry[]>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

SiteRequest.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: false, field: "org_id" },
    code: { type: DataTypes.STRING, allowNull: false, unique: true },
    type: { type: DataTypes.ENUM("Site Addition", "Site Change", "Site Closure"), allowNull: false },
    siteId: { type: DataTypes.UUID, allowNull: true, field: "site_id" },
    requestedBy: { type: DataTypes.STRING, allowNull: false, defaultValue: "Tenant", field: "requested_by" },
    proposed: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    reason: { type: DataTypes.TEXT, allowNull: true },
    status: {
      type: DataTypes.ENUM("Draft", "Submitted", "Under Review", "Approved", "Rejected", "Cancelled"),
      allowNull: false, defaultValue: "Submitted",
    },
    provisioned: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    provisionedSiteId: { type: DataTypes.UUID, allowNull: true, field: "provisioned_site_id" },
    audit: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "site_requests", underscored: true },
);
