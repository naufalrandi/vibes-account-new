import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { sequelize } from "../sequelize";

export type ElementStatus = "Draft" | "Active" | "Archived";

/**
 * A framework element is a reusable cross-reference concept (e.g. "Internal
 * Audit") that maps to requirements across many frameworks. `name` is globally
 * unique. Platform-global master data.
 */
export class Element extends Model<InferAttributes<Element>, InferCreationAttributes<Element>> {
  declare id: CreationOptional<string>;
  declare name: string;
  declare description: string | null;
  declare status: CreationOptional<ElementStatus>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

Element.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    name: { type: DataTypes.STRING, allowNull: false, unique: true },
    description: { type: DataTypes.TEXT, allowNull: true },
    status: { type: DataTypes.ENUM("Draft", "Active", "Archived"), allowNull: false, defaultValue: "Active" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "framework_elements", underscored: true },
);
