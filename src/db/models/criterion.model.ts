import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { sequelize } from "../sequelize";

/**
 * A maturity/compliance criterion for a requirement: a 0–9 score with a
 * descriptor (e.g. score 2 = "Audits are planned, documented, and recurring").
 * Standards surface these as "Conformance Criteria", regulations as
 * "Compliance Criteria". Platform-global master data.
 */
export class Criterion extends Model<InferAttributes<Criterion>, InferCreationAttributes<Criterion>> {
  declare id: CreationOptional<string>;
  declare requirementId: string;
  declare score: number;
  declare description: string;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

Criterion.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    requirementId: { type: DataTypes.UUID, allowNull: false, field: "requirement_id" },
    score: { type: DataTypes.INTEGER, allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: false },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  {
    sequelize,
    tableName: "assessment_criteria",
    underscored: true,
    indexes: [{ unique: true, fields: ["requirement_id", "score"], name: "assessment_criteria_req_score_unique" }],
  },
);
