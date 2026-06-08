import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { sequelize } from "../sequelize";

export type QuestionStatus = "Draft" | "Active";

/**
 * An assessment question attached to a framework element ("ask once, answer
 * once, evaluate many"). Questions are ordered for display. Platform-global
 * master data.
 */
export class Question extends Model<InferAttributes<Question>, InferCreationAttributes<Question>> {
  declare id: CreationOptional<string>;
  declare elementId: string;
  declare text: string;
  declare sortOrder: CreationOptional<number>;
  declare status: CreationOptional<QuestionStatus>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

Question.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    elementId: { type: DataTypes.UUID, allowNull: false, field: "element_id" },
    text: { type: DataTypes.TEXT, allowNull: false },
    sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: "sort_order" },
    status: { type: DataTypes.ENUM("Draft", "Active"), allowNull: false, defaultValue: "Active" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "assessment_questions", underscored: true },
);
