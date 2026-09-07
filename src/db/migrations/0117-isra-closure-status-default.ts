import type { Migration } from "../migrate";

/**
 * `isra_scenario_closure.status` defaulted to "Open", a literal no OD artifact
 * writes: the only two reads of `sc.closure` are `closure.nextReview`
 * (js/core.js:14762) and `closure.status === 'Closed'` (js/core.js:14851), and
 * C16 §8.1 gives the sub-object as `closure{status,nextReview}` with no
 * vocabulary. A non-null default gave every closure row a state OD has no
 * concept of, so the column becomes nullable with no default and existing
 * 'Open' rows are cleared — 'Closed' is the only meaningful value.
 */
export const up: Migration = async ({ context: q }) => {
  const s = q.sequelize;
  await s.query(`ALTER TABLE "isra_scenario_closure" ALTER COLUMN "status" DROP DEFAULT`);
  await s.query(`ALTER TABLE "isra_scenario_closure" ALTER COLUMN "status" DROP NOT NULL`);
  await s.query(`UPDATE "isra_scenario_closure" SET "status" = NULL WHERE "status" = 'Open'`);
};

export const down: Migration = async ({ context: q }) => {
  const s = q.sequelize;
  await s.query(`UPDATE "isra_scenario_closure" SET "status" = 'Open' WHERE "status" IS NULL`);
  await s.query(`ALTER TABLE "isra_scenario_closure" ALTER COLUMN "status" SET DEFAULT 'Open'`);
  await s.query(`ALTER TABLE "isra_scenario_closure" ALTER COLUMN "status" SET NOT NULL`);
};
