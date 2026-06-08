import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { sequelize } from "../sequelize";

/**
 * Links an assessment response to the criterion (score) it represents — the
 * scoring engine. One response maps to at most one criterion. The criterion may
 * belong to a requirement in any framework (cross-framework scoring).
 */
export class ResponseCriterion extends Model<
  InferAttributes<ResponseCriterion>,
  InferCreationAttributes<ResponseCriterion>
> {
  declare id: CreationOptional<string>;
  declare responseId: string;
  declare criterionId: string;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

ResponseCriterion.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    responseId: { type: DataTypes.UUID, allowNull: false, field: "response_id" },
    criterionId: { type: DataTypes.UUID, allowNull: false, field: "criterion_id" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  {
    sequelize,
    tableName: "assessment_response_criteria",
    underscored: true,
    indexes: [{ unique: true, fields: ["response_id"], name: "assessment_response_criteria_response_unique" }],
  },
);
