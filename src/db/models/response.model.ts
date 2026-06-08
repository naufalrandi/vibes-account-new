import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { sequelize } from "../sequelize";

export type ResponseStatus = "Draft" | "Active";

/**
 * A possible answer option to an assessment question. Each response can be
 * mapped to a single criterion (its score) via the response_criteria link.
 * Platform-global master data.
 */
export class Response extends Model<InferAttributes<Response>, InferCreationAttributes<Response>> {
  declare id: CreationOptional<string>;
  declare questionId: string;
  declare text: string;
  declare sortOrder: CreationOptional<number>;
  declare status: CreationOptional<ResponseStatus>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

Response.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    questionId: { type: DataTypes.UUID, allowNull: false, field: "question_id" },
    text: { type: DataTypes.TEXT, allowNull: false },
    sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: "sort_order" },
    status: { type: DataTypes.ENUM("Draft", "Active"), allowNull: false, defaultValue: "Active" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "assessment_responses", underscored: true },
);
