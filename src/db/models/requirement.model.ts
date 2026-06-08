import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { sequelize } from "../sequelize";

export type RequirementStatus = "Draft" | "Active" | "Archived";

/**
 * A requirement is a single clause/article of a framework (e.g. "Clause 9.2.1",
 * "Article 32") with a short subject and full description. `code` is unique
 * within its framework. Platform-global master data managed by the Service Owner.
 */
export class Requirement extends Model<
  InferAttributes<Requirement>,
  InferCreationAttributes<Requirement>
> {
  declare id: CreationOptional<string>;
  declare frameworkId: string;
  declare code: string;
  declare subject: string;
  declare description: string;
  declare status: CreationOptional<RequirementStatus>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

Requirement.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    frameworkId: { type: DataTypes.UUID, allowNull: false, field: "framework_id" },
    code: { type: DataTypes.STRING, allowNull: false },
    subject: { type: DataTypes.STRING, allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: false },
    status: { type: DataTypes.ENUM("Draft", "Active", "Archived"), allowNull: false, defaultValue: "Active" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  {
    sequelize,
    tableName: "framework_requirements",
    underscored: true,
    indexes: [{ unique: true, fields: ["framework_id", "code"], name: "framework_requirements_framework_code_unique" }],
  },
);
