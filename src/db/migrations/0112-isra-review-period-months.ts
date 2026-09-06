import type { Migration } from "../migrate";

/**
 * R310 — OD's review period is configured in MONTHS, not days:
 * `ISRA_REVIEW_PERIOD_DEFAULT = {within:6, above:2}` (js/core.js:14767) and
 * `isra2AddMonthsISO` adds calendar months. The port stored days and picked
 * 365/90, so a within-appetite scenario came due a year out instead of six
 * months. Existing rows are converted at ~30 days per month, floored at 1.
 */
export const up: Migration = async ({ context: q }) => {
  await q.renameColumn("isra_org_settings", "review_period_within_days", "review_period_within_months");
  await q.renameColumn("isra_org_settings", "review_period_above_days", "review_period_above_months");
  await q.sequelize.query(
    `UPDATE "isra_org_settings"
        SET "review_period_within_months" = GREATEST(1, ROUND("review_period_within_months" / 30.0))
      WHERE "review_period_within_months" IS NOT NULL`,
  );
  await q.sequelize.query(
    `UPDATE "isra_org_settings"
        SET "review_period_above_months" = GREATEST(1, ROUND("review_period_above_months" / 30.0))
      WHERE "review_period_above_months" IS NOT NULL`,
  );
};

export const down: Migration = async ({ context: q }) => {
  await q.sequelize.query(
    `UPDATE "isra_org_settings" SET "review_period_within_months" = "review_period_within_months" * 30
      WHERE "review_period_within_months" IS NOT NULL`,
  );
  await q.sequelize.query(
    `UPDATE "isra_org_settings" SET "review_period_above_months" = "review_period_above_months" * 30
      WHERE "review_period_above_months" IS NOT NULL`,
  );
  await q.renameColumn("isra_org_settings", "review_period_within_months", "review_period_within_days");
  await q.renameColumn("isra_org_settings", "review_period_above_months", "review_period_above_days");
};
