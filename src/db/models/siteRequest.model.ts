import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { sequelize } from "../sequelize";

export type SiteRequestType = "Site Addition" | "Site Change" | "Site Closure";
export type SiteRequestStatus = "Draft" | "Submitted" | "Under Review" | "Approved" | "Rejected" | "Cancelled";

export const SITE_REQUEST_TYPES: SiteRequestType[] = ["Site Addition", "Site Change", "Site Closure"];

/** Proposed changes carried by a site request (shape varies by request type). */
export interface SiteRequestProposed {
  name?: string;
  siteType?: string;
  country?: string | null;
  address?: string | null;
  isPrimary?: boolean;
}

/**
 * A site request is a tenant- or partner-initiated change to a tenant's sites:
 * adding a new site, changing an existing one, or closing one. The Service Owner
 * reviews and approves; an approved Site Addition is then provisioned into a Site.
 * `orgId` is the tenant organization the request belongs to.
 */
export class SiteRequest extends Model<InferAttributes<SiteRequest>, InferCreationAttributes<SiteRequest>> {
  declare id: CreationOptional<string>;
  declare orgId: string;
  declare code: string;
  declare type: SiteRequestType;
  declare siteId: string | null;
  declare requestedBy: string;
  declare proposed: SiteRequestProposed;
  declare reason: string | null;
  declare status: CreationOptional<SiteRequestStatus>;
  declare provisioned: CreationOptional<boolean>;
  declare provisionedSiteId: string | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

SiteRequest.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: false, field: "org_id" },
    code: { type: DataTypes.STRING, allowNull: false, unique: true },
    type: {
      type: DataTypes.ENUM("Site Addition", "Site Change", "Site Closure"),
      allowNull: false,
    },
    siteId: { type: DataTypes.UUID, allowNull: true, field: "site_id" },
    requestedBy: { type: DataTypes.STRING, allowNull: false, defaultValue: "ServiceOwner", field: "requested_by" },
    proposed: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    reason: { type: DataTypes.TEXT, allowNull: true },
    status: {
      type: DataTypes.ENUM("Draft", "Submitted", "Under Review", "Approved", "Rejected", "Cancelled"),
      allowNull: false,
      defaultValue: "Submitted",
    },
    provisioned: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    provisionedSiteId: { type: DataTypes.UUID, allowNull: true, field: "provisioned_site_id" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "site_requests", underscored: true },
);
