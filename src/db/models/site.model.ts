import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { sequelize } from "../sequelize";

export type SiteType =
  | "Head Office"
  | "Branch Office"
  | "Factory"
  | "Warehouse"
  | "Data Center"
  | "Subsidiary"
  | "Business Unit"
  | "Other";
export type SiteStatus = "Active" | "Inactive";

export const SITE_TYPES: SiteType[] = [
  "Head Office",
  "Branch Office",
  "Factory",
  "Warehouse",
  "Data Center",
  "Subsidiary",
  "Business Unit",
  "Other",
];

/**
 * A site is a physical/operational location belonging to a tenant organization.
 * Sites are controlled commercial objects provisioned only by the Service Owner;
 * each tenant has exactly one primary site. `orgId` is the tenant organization.
 */
export class Site extends Model<InferAttributes<Site>, InferCreationAttributes<Site>> {
  declare id: CreationOptional<string>;
  declare orgId: string;
  declare code: string;
  declare name: string;
  declare type: SiteType;
  declare country: string | null;
  declare address: string | null;
  declare status: CreationOptional<SiteStatus>;
  declare isPrimary: CreationOptional<boolean>;
  declare description: string | null;
  declare contactPerson: string | null;
  declare contactEmail: string | null;
  declare contactPhone: string | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

Site.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: false, field: "org_id" },
    code: { type: DataTypes.STRING, allowNull: false, unique: true },
    name: { type: DataTypes.STRING, allowNull: false },
    type: {
      type: DataTypes.ENUM(
        "Head Office",
        "Branch Office",
        "Factory",
        "Warehouse",
        "Data Center",
        "Subsidiary",
        "Business Unit",
        "Other",
      ),
      allowNull: false,
      defaultValue: "Branch Office",
    },
    country: { type: DataTypes.STRING, allowNull: true },
    address: { type: DataTypes.TEXT, allowNull: true },
    status: { type: DataTypes.ENUM("Active", "Inactive"), allowNull: false, defaultValue: "Active" },
    isPrimary: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: "is_primary" },
    description: { type: DataTypes.TEXT, allowNull: true },
    contactPerson: { type: DataTypes.STRING, allowNull: true, field: "contact_person" },
    contactEmail: { type: DataTypes.STRING, allowNull: true, field: "contact_email" },
    contactPhone: { type: DataTypes.STRING, allowNull: true, field: "contact_phone" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "sites", underscored: true },
);
