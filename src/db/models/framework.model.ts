import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { sequelize } from "../sequelize";

export type FrameworkStatus = "Draft" | "Active" | "Archived";

/**
 * A framework (AXIA model) belongs to a FrameworkGroup — "Standards" or
 * "Regulations". Regulations carry one or more jurisdictions (ISO 3166 codes or
 * supranational presets like EU/EEA/GLOBAL); standards leave it empty. Platform-
 * global master data managed only by the Service Owner. Requirements belong to a
 * framework.
 */
export class Framework extends Model<InferAttributes<Framework>, InferCreationAttributes<Framework>> {
  declare id: CreationOptional<string>;
  declare groupId: string | null;
  declare name: string;
  declare description: string | null;
  declare jurisdictions: CreationOptional<string[]>;
  declare status: CreationOptional<FrameworkStatus>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

Framework.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    groupId: { type: DataTypes.UUID, allowNull: true, field: "group_id" },
    name: { type: DataTypes.STRING, allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: true },
    jurisdictions: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Active" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "frameworks", underscored: true },
);
