import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { sequelize } from "../sequelize";

export type AssessmentRunStatus = "Draft" | "In Progress" | "Completed";
export type GapSeverity = "High" | "Medium" | "Low";

/** A tenant assessment run — answers to conformance questions for a framework. */
export class Assessment extends Model<InferAttributes<Assessment>, InferCreationAttributes<Assessment>> {
  declare id: CreationOptional<string>;
  declare code: string;
  declare orgId: string;
  declare siteId: string | null;
  declare frameworkId: string | null;
  declare title: string;
  declare status: CreationOptional<AssessmentRunStatus>;
  declare version: CreationOptional<number>;
  declare maturityScore: number | null;
  declare startedAt: Date | null;
  declare completedAt: Date | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
Assessment.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    code: { type: DataTypes.STRING, allowNull: false, unique: true },
    orgId: { type: DataTypes.UUID, allowNull: false, field: "org_id" },
    siteId: { type: DataTypes.UUID, allowNull: true, field: "site_id" },
    frameworkId: { type: DataTypes.UUID, allowNull: true, field: "framework_id" },
    title: { type: DataTypes.STRING, allowNull: false },
    status: { type: DataTypes.ENUM("Draft", "In Progress", "Completed"), allowNull: false, defaultValue: "Draft" },
    version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    // DECIMAL comes back as a string from pg; the service Number()-coerces on read.
    maturityScore: { type: DataTypes.DECIMAL(4, 2), allowNull: true, field: "maturity_score" },
    startedAt: { type: DataTypes.DATE, allowNull: true, field: "started_at" },
    completedAt: { type: DataTypes.DATE, allowNull: true, field: "completed_at" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "assessments", underscored: true },
);

/** One answered conformance question; score is denormalized from the rcmap. */
export class AssessmentAnswer extends Model<InferAttributes<AssessmentAnswer>, InferCreationAttributes<AssessmentAnswer>> {
  declare id: CreationOptional<string>;
  declare assessmentId: string;
  declare questionId: string;
  declare responseId: string | null;
  declare criterionId: string | null;
  declare score: number | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
AssessmentAnswer.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    assessmentId: { type: DataTypes.UUID, allowNull: false, field: "assessment_id" },
    questionId: { type: DataTypes.UUID, allowNull: false, field: "question_id" },
    responseId: { type: DataTypes.UUID, allowNull: true, field: "response_id" },
    criterionId: { type: DataTypes.UUID, allowNull: true, field: "criterion_id" },
    score: { type: DataTypes.INTEGER, allowNull: true },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "assessment_answers", underscored: true },
);

/** A derived gap — a weak element with a recommended implementation module. */
export class Gap extends Model<InferAttributes<Gap>, InferCreationAttributes<Gap>> {
  declare id: CreationOptional<string>;
  declare assessmentId: string;
  declare elementId: string | null;
  declare elementName: string;
  declare score: number;
  declare severity: GapSeverity;
  declare recommendedModuleKey: string;
  declare recommendedModuleLabel: string;
  declare recommendedRoute: string;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
Gap.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    assessmentId: { type: DataTypes.UUID, allowNull: false, field: "assessment_id" },
    elementId: { type: DataTypes.UUID, allowNull: true, field: "element_id" },
    elementName: { type: DataTypes.STRING, allowNull: false, field: "element_name" },
    score: { type: DataTypes.DECIMAL(4, 2), allowNull: false },
    severity: { type: DataTypes.ENUM("High", "Medium", "Low"), allowNull: false },
    recommendedModuleKey: { type: DataTypes.STRING, allowNull: false, field: "recommended_module_key" },
    recommendedModuleLabel: { type: DataTypes.STRING, allowNull: false, field: "recommended_module_label" },
    recommendedRoute: { type: DataTypes.STRING, allowNull: false, field: "recommended_route" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "gaps", underscored: true },
);
