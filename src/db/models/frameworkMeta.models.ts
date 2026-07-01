import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { sequelize } from "../sequelize";

export type LibraryStatus = "Draft" | "Active" | "Archived";
export type ElementCategory = "Core" | "Framework Extension";
export type AssessmentStatus = "Draft" | "Active";

/** Framework grouping (Standards / Regulations) for the meta-model Library. */
export class FrameworkGroup extends Model<InferAttributes<FrameworkGroup>, InferCreationAttributes<FrameworkGroup>> {
  declare id: CreationOptional<string>;
  declare name: string;
  declare sortOrder: CreationOptional<number>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
FrameworkGroup.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    name: { type: DataTypes.STRING, allowNull: false, unique: true },
    sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: "sort_order" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "framework_groups", underscored: true },
);

/** Framework Element (FWE) — reusable capability mapped across standards. */
export class FrameworkElement extends Model<InferAttributes<FrameworkElement>, InferCreationAttributes<FrameworkElement>> {
  declare id: CreationOptional<string>;
  declare code: string;
  declare name: string;
  declare description: string | null;
  declare category: CreationOptional<ElementCategory>;
  declare status: CreationOptional<LibraryStatus>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
FrameworkElement.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    code: { type: DataTypes.STRING, allowNull: false, unique: true },
    name: { type: DataTypes.STRING, allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: true },
    category: { type: DataTypes.ENUM("Core", "Framework Extension"), allowNull: false, defaultValue: "Core" },
    status: { type: DataTypes.ENUM("Draft", "Active", "Archived"), allowNull: false, defaultValue: "Active" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "framework_elements", underscored: true },
);

/** Framework Requirement (FWR) — a clause within a framework. */
export class FrameworkRequirement extends Model<InferAttributes<FrameworkRequirement>, InferCreationAttributes<FrameworkRequirement>> {
  declare id: CreationOptional<string>;
  declare frameworkId: string;
  declare code: string;
  declare subject: string;
  declare description: string;
  declare status: CreationOptional<LibraryStatus>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
FrameworkRequirement.init(
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
  { sequelize, tableName: "framework_requirements", underscored: true },
);

/** Requirement Criterion (FWRC) — maturity rubric per requirement (score 0–9). */
export class RequirementCriterion extends Model<InferAttributes<RequirementCriterion>, InferCreationAttributes<RequirementCriterion>> {
  declare id: CreationOptional<string>;
  declare requirementId: string;
  declare score: number;
  declare description: string;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
RequirementCriterion.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    requirementId: { type: DataTypes.UUID, allowNull: false, field: "requirement_id" },
    score: { type: DataTypes.INTEGER, allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: false },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "requirement_criteria", underscored: true },
);

/** Element ↔ Requirement cross-reference (xref) join. */
export class ElementRequirementXref extends Model<InferAttributes<ElementRequirementXref>, InferCreationAttributes<ElementRequirementXref>> {
  declare id: CreationOptional<string>;
  declare elementId: string;
  declare requirementId: string;
}
ElementRequirementXref.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    elementId: { type: DataTypes.UUID, allowNull: false, field: "element_id" },
    requirementId: { type: DataTypes.UUID, allowNull: false, field: "requirement_id" },
  },
  { sequelize, tableName: "element_requirement_xref", underscored: true, timestamps: false },
);

/** Conformance Question (CQ) — framework-neutral, keyed to an element. */
export class ConformanceQuestion extends Model<InferAttributes<ConformanceQuestion>, InferCreationAttributes<ConformanceQuestion>> {
  declare id: CreationOptional<string>;
  declare elementId: string;
  declare text: string;
  declare sortOrder: CreationOptional<number>;
  declare status: CreationOptional<AssessmentStatus>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
ConformanceQuestion.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    elementId: { type: DataTypes.UUID, allowNull: false, field: "element_id" },
    text: { type: DataTypes.TEXT, allowNull: false },
    sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: "sort_order" },
    status: { type: DataTypes.ENUM("Draft", "Active"), allowNull: false, defaultValue: "Draft" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "conformance_questions", underscored: true },
);

/** Conformance Response (CQR) — a graded answer; `criterionId` is the rcmap link. */
export class ConformanceResponse extends Model<InferAttributes<ConformanceResponse>, InferCreationAttributes<ConformanceResponse>> {
  declare id: CreationOptional<string>;
  declare questionId: string;
  declare text: string;
  declare sortOrder: CreationOptional<number>;
  declare status: CreationOptional<AssessmentStatus>;
  declare criterionId: string | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
ConformanceResponse.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    questionId: { type: DataTypes.UUID, allowNull: false, field: "question_id" },
    text: { type: DataTypes.TEXT, allowNull: false },
    sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: "sort_order" },
    status: { type: DataTypes.ENUM("Draft", "Active"), allowNull: false, defaultValue: "Draft" },
    criterionId: { type: DataTypes.UUID, allowNull: true, field: "criterion_id" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "conformance_responses", underscored: true },
);
