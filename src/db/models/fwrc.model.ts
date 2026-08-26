import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { sequelize } from "../sequelize";

/**
 * FWRC — Framework Requirement Criteria join (OD's fwrcView). Links a conformance
 * RESPONSE (an answer option on a framework element's question) to a framework
 * REQUIREMENT with a maturity STATEMENT. This is the 5-way library join
 * (framework → requirement → element → question → response) distinct from the
 * per-requirement scoring rubric (RequirementCriterion). SP-global, no org scope.
 */
export class Fwrc extends Model<InferAttributes<Fwrc>, InferCreationAttributes<Fwrc>> {
  declare id: CreationOptional<string>;
  declare code: string;
  declare frameworkId: string;
  declare requirementId: string;
  declare elementId: string;
  declare questionId: string | null;
  declare responseId: string;
  declare statement: string;
  declare status: CreationOptional<string>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

Fwrc.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    code: { type: DataTypes.STRING, allowNull: false },
    frameworkId: { type: DataTypes.UUID, allowNull: false, field: "framework_id" },
    requirementId: { type: DataTypes.UUID, allowNull: false, field: "requirement_id" },
    elementId: { type: DataTypes.UUID, allowNull: false, field: "element_id" },
    questionId: { type: DataTypes.UUID, allowNull: true, field: "question_id" },
    responseId: { type: DataTypes.UUID, allowNull: false, field: "response_id" },
    statement: { type: DataTypes.TEXT, allowNull: false },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Active" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "fwrc", underscored: true },
);
