import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * ISRA gap-register Wave Q, task S3 — OD's `sc.residual` carries the raw
 * Likelihood/Consequence pair directly (`r.L`/`r.impact`, set by
 * `isra2ResidualForm.onOk`, app.html:18525), not just the derived score.
 * `isra_scenario_residual` (migration 0067, adequacy added in 0074) has no
 * column for either half of that pair, so a residual can be saved with a
 * score but no L×C breakdown — no consumer can render an L×C residual cell
 * (FE `IsraResidualItem`, lib/api/types.ts:2291, documented gap in
 * lib/isra/israHeatMap.ts's `israStageLC`, "residual" branch — see the G-32
 * task report and the S3 brief).
 *
 * Scoped to this table only, same reasoning as 0074: the values are carried
 * forward into `IsraScenarioCycle.snapshot` (frozen JSONB) on promote, so
 * `isra_scenario_current_risk` picks them up there rather than needing its
 * own duplicate of this fix.
 */
export const up: Migration = async ({ context: q }) => {
  await q.addColumn("isra_scenario_residual", "l", { type: DataTypes.INTEGER, allowNull: true });
  await q.addColumn("isra_scenario_residual", "impact", { type: DataTypes.INTEGER, allowNull: true });
};

export const down: Migration = async ({ context: q }) => {
  await q.removeColumn("isra_scenario_residual", "impact");
  await q.removeColumn("isra_scenario_residual", "l");
};
