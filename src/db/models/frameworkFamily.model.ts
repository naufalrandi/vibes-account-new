import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { sequelize } from "../sequelize";

export type FrameworkFamilyStatus = "Active" | "Inactive";

/**
 * A framework family groups frameworks under a parent framework type. Families
 * are platform-global configuration managed only by the Service Owner.
 */
export class FrameworkFamily extends Model<
  InferAttributes<FrameworkFamily>,
  InferCreationAttributes<FrameworkFamily>
> {
  declare id: CreationOptional<string>;
  declare code: string;
  declare name: string;
  declare frameworkTypeId: string;
  declare sortOrder: CreationOptional<number>;
  declare status: CreationOptional<FrameworkFamilyStatus>;
  declare description: string | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

FrameworkFamily.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    code: { type: DataTypes.STRING, allowNull: false, unique: true },
    name: { type: DataTypes.STRING, allowNull: false },
    frameworkTypeId: { type: DataTypes.UUID, allowNull: false, field: "framework_type_id" },
    sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: "sort_order" },
    status: { type: DataTypes.ENUM("Active", "Inactive"), allowNull: false, defaultValue: "Active" },
    description: { type: DataTypes.TEXT, allowNull: true },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "framework_families", underscored: true },
);
