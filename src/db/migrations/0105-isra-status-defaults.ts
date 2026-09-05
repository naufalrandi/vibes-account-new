import type { Migration } from "../migrate";

/**
 * Two column defaults that did not match the design.
 *
 * `isra_rtp_actions.status` defaulted to "Planned", a port-only value absent
 * from OD's `ISRA4_ACT_STATUS` (js/core.js:15409, eight members starting at
 * 'Not started'). Existing rows holding it are moved to 'Not started', which is
 * the state OD gives a freshly planned action.
 *
 * `isra_sa_subgroups.status` defaulted to "Draft"; OD's SA sub-group review
 * vocabulary (js/core.js:15784) has no 'Draft', its roll-up treats a missing
 * value as 'Under review' (:15788), and its own seeded rows carry
 * 'Under review' (:16536). 'Draft' and 'Retired' rows migrate to 'Under review'.
 *
 * Both columns are plain STRING, so only the default and the stored values
 * change — no enum type to recreate.
 */
export const up: Migration = async ({ context: q }) => {
  const s = q.sequelize;
  await s.query(`UPDATE "isra_rtp_actions" SET "status" = 'Not started' WHERE "status" = 'Planned'`);
  await s.query(`ALTER TABLE "isra_rtp_actions" ALTER COLUMN "status" SET DEFAULT 'Not started'`);
  await s.query(`UPDATE "isra_sa_subgroups" SET "status" = 'Under review' WHERE "status" IN ('Draft', 'Retired')`);
  await s.query(`ALTER TABLE "isra_sa_subgroups" ALTER COLUMN "status" SET DEFAULT 'Under review'`);
  // 'Published' was never an edge state in OD — it is the map-level status
  // `isra2KmPublish` (js/core.js:15854) sets on `_israMapMeta`. Approved is the
  // nearest edge-level equivalent for any row that picked it up.
  await s.query(`UPDATE "isra_km_vuln_control" SET "status" = 'Approved' WHERE "status" = 'Published'`);
};

export const down: Migration = async ({ context: q }) => {
  const s = q.sequelize;
  await s.query(`ALTER TABLE "isra_rtp_actions" ALTER COLUMN "status" SET DEFAULT 'Planned'`);
  await s.query(`ALTER TABLE "isra_sa_subgroups" ALTER COLUMN "status" SET DEFAULT 'Draft'`);
};
