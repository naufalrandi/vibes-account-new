import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * Assessment instruments — the written-exam ladder (L1–L3, auto-scored) and the
 * L4 assessor-observed practical rubric, plus per-person attempts. Questions and
 * criteria are JSONB. Instruments are SP-owned (skill-scoped); attempts are
 * org-scoped to the tenant that ran them.
 */
export const up: Migration = async ({ context: q }) => {
  await q.createTable("competence_exam_instruments", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    skill_id: { type: DataTypes.UUID, allowNull: false, references: { model: "competence_skills", key: "id" }, onDelete: "CASCADE" },
    level: { type: DataTypes.INTEGER, allowNull: false },
    name: { type: DataTypes.STRING, allowNull: false },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Draft" },
    pass_mark: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 70 },
    duration_min: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 30 },
    attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    shuffle_q: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    draw_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    questions: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
  await q.addIndex("competence_exam_instruments", ["skill_id"]);

  await q.createTable("competence_practical_instruments", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    skill_id: { type: DataTypes.UUID, allowNull: false, references: { model: "competence_skills", key: "id" }, onDelete: "CASCADE" },
    level: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 4 },
    name: { type: DataTypes.STRING, allowNull: false },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Draft" },
    pass_mark: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 75 },
    criteria: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
  await q.addIndex("competence_practical_instruments", ["skill_id"]);

  const attemptCols = {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: { type: DataTypes.UUID, allowNull: false, references: { model: "organizations", key: "id" }, onDelete: "CASCADE" },
    instrument_id: { type: DataTypes.UUID, allowNull: false },
    skill_id: { type: DataTypes.UUID, allowNull: false },
    level: { type: DataTypes.INTEGER, allowNull: false },
    person_id: { type: DataTypes.UUID, allowNull: false },
    person_name: { type: DataTypes.STRING, allowNull: true },
    score: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    earned: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    total: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    passed: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    preview: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    taken_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  };
  await q.createTable("competence_exam_attempts", { ...attemptCols });
  await q.addIndex("competence_exam_attempts", ["org_id"]);
  await q.addIndex("competence_exam_attempts", ["person_id", "skill_id"]);

  await q.createTable("competence_practical_attempts", {
    ...attemptCols,
    level: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 4 },
    assessor: { type: DataTypes.STRING, allowNull: true },
    evidence: { type: DataTypes.TEXT, allowNull: true },
  });
  await q.addIndex("competence_practical_attempts", ["org_id"]);
  await q.addIndex("competence_practical_attempts", ["person_id", "skill_id"]);
};

export const down: Migration = async ({ context: q }) => {
  await q.dropTable("competence_practical_attempts");
  await q.dropTable("competence_exam_attempts");
  await q.dropTable("competence_practical_instruments");
  await q.dropTable("competence_exam_instruments");
};
