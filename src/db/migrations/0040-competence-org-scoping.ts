import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * Competence org scoping + assessor-graded exam attempts.
 *
 * 1. `org_id` (nullable) on the skill library and both instrument tables —
 *    restores OD's dual model (global SP library + tenant-scoped rows,
 *    index.html:16740 vs 13382): NULL rows are the platform-global library,
 *    non-NULL rows belong to the owning tenant. `competence_education` (the
 *    shared ISCED ladder) deliberately stays global — OD treats it as
 *    read-only reference data (index.html:17793), so writes are restricted
 *    to the Service Owner in the service layer instead.
 *
 * 2. Exam attempts gain `status` / `answers` / `grades` for OD's assessor
 *    grading phase (index.html:18142–18164): an attempt with short-answer
 *    questions is stored as "PendingGrading" with the candidate's raw answers;
 *    the grade endpoint records per-question awarded points and finalizes.
 */
export const up: Migration = async ({ context: q }) => {
  const orgCol = () => ({
    type: DataTypes.UUID, allowNull: true,
    references: { model: "organizations", key: "id" }, onDelete: "CASCADE",
  });
  await q.addColumn("competence_skills", "org_id", orgCol());
  await q.addColumn("competence_exam_instruments", "org_id", orgCol());
  await q.addColumn("competence_practical_instruments", "org_id", orgCol());
  await q.addIndex("competence_skills", ["org_id"]);
  await q.addIndex("competence_exam_instruments", ["org_id"]);
  await q.addIndex("competence_practical_instruments", ["org_id"]);

  await q.addColumn("competence_exam_attempts", "status", { type: DataTypes.STRING, allowNull: false, defaultValue: "Completed" });
  await q.addColumn("competence_exam_attempts", "answers", { type: DataTypes.JSONB, allowNull: false, defaultValue: {} });
  await q.addColumn("competence_exam_attempts", "grades", { type: DataTypes.JSONB, allowNull: false, defaultValue: {} });
};

export const down: Migration = async ({ context: q }) => {
  await q.removeColumn("competence_exam_attempts", "grades");
  await q.removeColumn("competence_exam_attempts", "answers");
  await q.removeColumn("competence_exam_attempts", "status");
  await q.removeColumn("competence_practical_instruments", "org_id");
  await q.removeColumn("competence_exam_instruments", "org_id");
  await q.removeColumn("competence_skills", "org_id");
};
