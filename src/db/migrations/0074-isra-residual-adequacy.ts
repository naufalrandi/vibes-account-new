import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * ISRA gap-register Wave Q, G-91 — "adequacy computed on save". OD computes
 * and stores an adequacy verdict (`isra2AdqEval(score)`: threshold, result,
 * assessedAt) on `sc.residual` the moment a residual is assessed
 * (`isra2ResidualForm.onOk`: `adequacy:isra2AdqEval(sco)`), so a later change
 * to the org's risk-appetite threshold never rewrites a past assessment's
 * within/above-appetite verdict.
 *
 * `isra_scenario_residual` (migration 0067) has no column to hold this
 * snapshot — add one. Scoped to this table only: the adequacy value is
 * carried forward into `IsraScenarioCycle.snapshot` (a frozen JSONB blob)
 * when a residual is promoted, so `isra_scenario_current_risk` does not also
 * need the column.
 */
export const up: Migration = async ({ context: q }) => {
  await q.addColumn("isra_scenario_residual", "adequacy", { type: DataTypes.JSONB, allowNull: true });
};

export const down: Migration = async ({ context: q }) => {
  await q.removeColumn("isra_scenario_residual", "adequacy");
};
