import type { Migration } from "../migrate";

/**
 * BE-10: Server-side lead duplicate detection (business.service.ts
 * `assertNoDuplicateLead`). OD's uniqueness key for a Lead is legal name +
 * organization type + country, not the display name alone (app.html:29334-
 * 29338), scoped to `org_id` + `company` (the 0056 index already covers those
 * plain columns). The comparison itself reaches into the JSONB `data` blob
 * (`data->'legal'->>'legalName'`, `data->'legal'->>'orgType'`,
 * `data->>'country'`), which no existing index covers.
 *
 * No prior migration indexes a JSONB expression, so this adds a raw-SQL
 * partial expression index scoped to the Leads module, mirroring the exact
 * predicate the duplicate-check query issues (same COALESCE/NULLIF fallback
 * chain as `leadIdentityOf`).
 */
export const up: Migration = async ({ context: q }) => {
  await q.sequelize.query(`
    CREATE INDEX business_records_lead_identity_idx
    ON business_records (
      org_id,
      company,
      (lower(COALESCE(NULLIF(data#>>'{legal,legalName}', ''), NULLIF(data->>'company', ''), title))),
      (COALESCE(data#>>'{legal,orgType}', '')),
      (COALESCE(data->>'country', ''))
    )
    WHERE area = 'enterprise' AND module = 'ent-leads'
  `);
};

export const down: Migration = async ({ context: q }) => {
  await q.sequelize.query(`DROP INDEX IF EXISTS business_records_lead_identity_idx`);
};
