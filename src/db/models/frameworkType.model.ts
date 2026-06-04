import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { sequelize } from "../sequelize";

export type FrameworkTypeStatus = "Active" | "Inactive";

export class FrameworkType extends Model<
  InferAttributes<FrameworkType>,
  InferCreationAttributes<FrameworkType>
> {
  declare id: CreationOptional<string>;
  declare code: string;
  declare name: string;
  declare description: string | null;
  declare sortOrder: CreationOptional<number>;
  declare status: CreationOptional<FrameworkTypeStatus>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

FrameworkType.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    code: { type: DataTypes.STRING, allowNull: false, unique: true },
    name: { type: DataTypes.STRING, allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: true },
    sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: "sort_order" },
    status: { type: DataTypes.ENUM("Active", "Inactive"), allowNull: false, defaultValue: "Active" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "framework_types", underscored: true },
);
