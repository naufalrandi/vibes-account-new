import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * Phase 8 — Tenant assessment run engine + gap analysis.
 *
 * Phase 7 built the *authoring* layer (Framework Elements, Requirements,
 * Criteria, Conformance Questions/Responses, and the response→criterion rcmap).
 * This phase adds the *tenant-side* run engine: a tenant answers the conformance
 * questions for a framework, each answer resolves through the rcmap to a maturity
 * score (0–9), and per-element scores below a threshold surface as gaps with a
 * recommended implementation module.
 *
 *   assessments        one run: tenant org + optional site/framework scope
 *   assessment_answers  one row per answered question (denormalized score)
 *   gaps                derived on finalize: weak element → recommended module
 */
export const up: Migration = async ({ context: q }) => {
  await q.createTable("assessments", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    code: { type: DataTypes.STRING, allowNull: false, unique: true },
    org_id: { type: DataTypes.UUID, allowNull: false, references: { model: "organizations", key: "id" }, onDelete: "CASCADE" },
    site_id: { type: DataTypes.UUID, allowNull: true, references: { model: "sites", key: "id" }, onDelete: "SET NULL" },
    framework_id: { type: DataTypes.UUID, allowNull: true, references: { model: "frameworks", key: "id" }, onDelete: "SET NULL" },
    title: { type: DataTypes.STRING, allowNull: false },
    status: { type: DataTypes.ENUM("Draft", "In Progress", "Completed"), allowNull: false, defaultValue: "Draft" },
    version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    maturity_score: { type: DataTypes.DECIMAL(4, 2), allowNull: true },
    started_at: { type: DataTypes.DATE, allowNull: true },
    completed_at: { type: DataTypes.DATE, allowNull: true },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
  await q.addIndex("assessments", ["org_id"]);

  await q.createTable("assessment_answers", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    assessment_id: { type: DataTypes.UUID, allowNull: false, references: { model: "assessments", key: "id" }, onDelete: "CASCADE" },
    question_id: { type: DataTypes.UUID, allowNull: false, references: { model: "conformance_questions", key: "id" }, onDelete: "CASCADE" },
    response_id: { type: DataTypes.UUID, allowNull: true, references: { model: "conformance_responses", key: "id" }, onDelete: "SET NULL" },
    // Denormalized from the rcmap at answer time so results stay stable even if
    // the SP later re-maps the response.
    criterion_id: { type: DataTypes.UUID, allowNull: true, references: { model: "requirement_criteria", key: "id" }, onDelete: "SET NULL" },
    score: { type: DataTypes.INTEGER, allowNull: true },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
  await q.addIndex("assessment_answers", ["assessment_id"]);
  await q.addConstraint("assessment_answers", { fields: ["assessment_id", "question_id"], type: "unique", name: "assessment_answer_unique" });

  await q.createTable("gaps", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    assessment_id: { type: DataTypes.UUID, allowNull: false, references: { model: "assessments", key: "id" }, onDelete: "CASCADE" },
    element_id: { type: DataTypes.UUID, allowNull: true, references: { model: "framework_elements", key: "id" }, onDelete: "SET NULL" },
    element_name: { type: DataTypes.STRING, allowNull: false },
    score: { type: DataTypes.DECIMAL(4, 2), allowNull: false },
    severity: { type: DataTypes.ENUM("High", "Medium", "Low"), allowNull: false },
    recommended_module_key: { type: DataTypes.STRING, allowNull: false },
    recommended_module_label: { type: DataTypes.STRING, allowNull: false },
    recommended_route: { type: DataTypes.STRING, allowNull: false },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
  await q.addIndex("gaps", ["assessment_id"]);
};

export const down: Migration = async ({ context: q }) => {
  await q.dropTable("gaps");
  await q.dropTable("assessment_answers");
  await q.dropTable("assessments");
};
