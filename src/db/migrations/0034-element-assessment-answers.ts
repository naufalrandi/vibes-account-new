import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * Persisted answer state for the Framework Element assessment (OD `fwe-assess` /
 * `db.fweAssess[elId] = {ans, fw}`) — a Service-Provider self-assessment tool
 * scoring how well an authored element covers/matures against its Coverage and
 * Maturity conformance questions. One row per question (upserted on answer);
 * `frameworks` holds the picked framework names when the chosen response is a
 * "child" response (OD's per-question framework multi-select).
 */
export const up: Migration = async ({ context: q }) => {
  await q.createTable("element_assessment_answers", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    element_id: { type: DataTypes.UUID, allowNull: false, references: { model: "framework_elements", key: "id" }, onDelete: "CASCADE" },
    question_id: { type: DataTypes.UUID, allowNull: false, unique: true, references: { model: "conformance_questions", key: "id" }, onDelete: "CASCADE" },
    response_id: { type: DataTypes.UUID, allowNull: true, references: { model: "conformance_responses", key: "id" }, onDelete: "SET NULL" },
    frameworks: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
  await q.sequelize.query('CREATE INDEX IF NOT EXISTS "element_assessment_answers_element_id" ON "element_assessment_answers" ("element_id")');
};

export const down: Migration = async ({ context: q }) => {
  await q.dropTable("element_assessment_answers");
};
