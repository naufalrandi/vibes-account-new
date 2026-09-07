import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * Three baseline gaps left in the ISRA treatment/RTP chain after 0098.
 *
 * 1. `isra_scenario_recommendation_snapshots` (R63) — the port matched
 *    isra-spec.md:95's flat `{controls, mapVersion, generatedAt}` shape and
 *    dropped everything OD's own `isra2SnapEnsure` writes (js/core.js:15113).
 *    `version` is the one element BOTH baseline sides require — isra-spec.md:163
 *    calls for a "new snapshot + new version stamp" on every refresh — and it
 *    had no column at all, so a refreshed snapshot could not be told from the
 *    one an assessor actually ruled on. `included_vuln_ids` and `needs_review`
 *    come from core.js's own record. (The per-item `title`/`rationale[]` live
 *    inside the existing `controls` JSONB and need no DDL.)
 *
 * 2. `isra_scenario_added_controls.existing_control_id` (R56) — OD's optional
 *    back-link from a committed Annex A control to the Existing Control that
 *    already covers it; its validator is js/core.js:15428.
 *
 * 3. `isra_scenario_treatment_decisions.status` (R49) — OD derives it on save
 *    as `opt === 'Retain' ? 'Accepted' : 'Planning'` (js/core.js:15152), and
 *    those two are the only values it ever stores. The column defaulted to
 *    "Draft" and the service wrote "Active", neither of which appears anywhere
 *    in the baseline. Stored rows outside the pair move to 'Planning' — the
 *    state a decision that is not an accepted Retain is in.
 */
export const up: Migration = async ({ context: q }) => {
  const s = q.sequelize;

  await q.addColumn("isra_scenario_recommendation_snapshots", "version", { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 });
  await q.addColumn("isra_scenario_recommendation_snapshots", "included_vuln_ids", { type: DataTypes.JSONB, allowNull: false, defaultValue: [] });
  await q.addColumn("isra_scenario_recommendation_snapshots", "needs_review", { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });

  await q.addColumn("isra_scenario_added_controls", "existing_control_id", { type: DataTypes.UUID, allowNull: true });

  await s.query(`UPDATE "isra_scenario_treatment_decisions" SET "status" = 'Planning' WHERE "status" NOT IN ('Planning', 'Accepted')`);
  await s.query(`ALTER TABLE "isra_scenario_treatment_decisions" ALTER COLUMN "status" SET DEFAULT 'Planning'`);
};

export const down: Migration = async ({ context: q }) => {
  await q.sequelize.query(`ALTER TABLE "isra_scenario_treatment_decisions" ALTER COLUMN "status" SET DEFAULT 'Draft'`);
  await q.removeColumn("isra_scenario_added_controls", "existing_control_id");
  await q.removeColumn("isra_scenario_recommendation_snapshots", "needs_review");
  await q.removeColumn("isra_scenario_recommendation_snapshots", "included_vuln_ids");
  await q.removeColumn("isra_scenario_recommendation_snapshots", "version");
};
