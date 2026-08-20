import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * Competence gap → training plan disposition (OD `compGapTpBadge` /
 * `compGapLinkTraining` / `compGapNoTraining` / `tpReassessSave` / `tpSet`,
 * index.html:14090-14226). Adds exactly four columns — every other field
 * those functions touch (`status`, `resolvedDate`, `resolvedBy`, `training`,
 * `trainingDone`, `trainingDate`, `action`, `owner`, `due`) already exists on
 * `competence_gaps` (migration 0020).
 *
 * `training_plan_id` is STRING, not UUID/FK: the Training Plan record lives
 * in the implementation module (src/modules/implementation/**), which this
 * migration must not reach into or assume an id shape for.
 *
 * `reassess_result` mirrors OD's `gap.reassessResult` — written by
 * `tpReassessSave` (14184-14192) alongside the `status` transition.
 */
export const up: Migration = async ({ context: q }) => {
  await q.addColumn("competence_gaps", "training_plan_id", { type: DataTypes.STRING, allowNull: true });
  await q.addColumn("competence_gaps", "no_training", { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });
  await q.addColumn("competence_gaps", "no_training_reason", { type: DataTypes.TEXT, allowNull: true });
  await q.addColumn("competence_gaps", "reassess_result", { type: DataTypes.STRING, allowNull: true });
};

export const down: Migration = async ({ context: q }) => {
  await q.removeColumn("competence_gaps", "reassess_result");
  await q.removeColumn("competence_gaps", "no_training_reason");
  await q.removeColumn("competence_gaps", "no_training");
  await q.removeColumn("competence_gaps", "training_plan_id");
};
