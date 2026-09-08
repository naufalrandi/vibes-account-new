import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * F-318 — two leftovers on `isra_scenario_residual` (created by 0067).
 *
 * a) `notes` is dead. OD's `sc.residual` carries exactly
 *    `{L, impact, score, band, rationale, assessedBy, assessmentDate,
 *    adequacy, needsReview}` — there is no `notes` member. When the port
 *    renamed its residual prose to `rationale` (kept in the pre-existing
 *    `basis` column) it left `notes` behind; nothing reads it, and the only
 *    thing that filled it was the demo seeder, which was mistakenly writing
 *    OD's `residual.rationale` into it (and its own `rationale` into a `basis`
 *    key Sequelize does not know), so a seeded residual rendered with an empty
 *    rationale. The seeder is corrected alongside this drop.
 *
 * b) `needsReview` is missing. It IS an OD residual member — every
 *    `sc.residual` literal carries `needsReview:false` — and the frontend
 *    (`IsraResidualItem.needsReview`, `IsraScenarioDetail`'s "Requires review"
 *    chip) already reads it, so the type was asserting something the database
 *    could not hold. Like OD, only `false` is ever written:
 *    `isra2MarkTreatReview` (js/core.js:15110) raises the flag on
 *    recSnapshot/treatment/projected/actual, never on residual.
 */
export const up: Migration = async ({ context: q }) => {
  await q.removeColumn("isra_scenario_residual", "notes");
  await q.addColumn("isra_scenario_residual", "needs_review", { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });
};

export const down: Migration = async ({ context: q }) => {
  await q.removeColumn("isra_scenario_residual", "needs_review");
  await q.addColumn("isra_scenario_residual", "notes", { type: DataTypes.TEXT, allowNull: true });
};
