import type { Migration } from "../migrate";

/**
 * F-173 — the five `ent-mkt-*` Website CMS registers are dead. The screen
 * (`EnterpriseWebsiteCmsPage`) moved onto the first-class `/cms/*` contract in
 * R173, which is also what `/v1/public/cms` publishes the live site from; the
 * registers were the legacy second copy it used to write instead. Their zod
 * schemas (`modules/business/dataSchemas.ts`) and seeder rows
 * (`db/seeders/businessRecordsSeed.ts`) are removed in the same pass, so any
 * row left behind sits under a module key the application no longer
 * recognizes — nothing reads it and nothing validates a write to it.
 *
 * Same shape as `0073-drop-invented-implementation-modules`: the CMS content
 * itself is untouched, it lives in the `cms_*` tables seeded from the one
 * `cms.data.ts` dataset.
 */
export const up: Migration = async ({ context: q }) => {
  await q.sequelize.query(
    "DELETE FROM business_records WHERE module IN ('ent-mkt-pages', 'ent-mkt-posts', 'ent-mkt-media', 'ent-mkt-menu', 'ent-mkt-settings')",
  );
};

/** Irreversible by design — the deleted rows were a duplicate of the `cms_*` tables, which still hold the content. */
export const down: Migration = async () => {
  /* no-op */
};
