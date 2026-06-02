import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { sequelize } from "../sequelize";

export type OrgType = "ServiceOwner" | "Distributor" | "Tenant";
export type OrgStatus = "Draft" | "PendingApproval" | "Active" | "Suspended" | "Inactive";

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
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "organizations", underscored: true },
);
