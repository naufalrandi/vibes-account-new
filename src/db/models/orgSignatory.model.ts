import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { sequelize } from "../sequelize";

export type SignatoryStatus = "Active" | "Inactive";

/**
 * An authorized representative of an organization (agreement signing). Org-scoped
 * via `orgId`, which is always taken from the authenticated context — never from
 * client input — so a caller can only ever read or mutate its own signatories.
 */
export class OrgSignatory extends Model<
  InferAttributes<OrgSignatory>,
  InferCreationAttributes<OrgSignatory>
> {
  declare id: CreationOptional<string>;
  declare orgId: string;
  declare fullName: string;
  declare title: string;
  declare email: string;
  declare signatureImage: string | null;
  declare status: CreationOptional<SignatoryStatus>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

OrgSignatory.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: false, field: "org_id" },
    fullName: { type: DataTypes.STRING, allowNull: false, field: "full_name" },
    title: { type: DataTypes.STRING, allowNull: false },
    email: { type: DataTypes.STRING, allowNull: false },
    signatureImage: { type: DataTypes.TEXT, allowNull: true, field: "signature_image" },
    status: { type: DataTypes.ENUM("Active", "Inactive"), allowNull: false, defaultValue: "Active" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "org_signatories", underscored: true },
);
