import type { Migration } from "../migrate";

/**
 * OD writes organisation status as "Pending Approval", with a space — 24
 * occurrences across js/core.js (126, 169, 170, ...) and 6 more in
 * js/modules.js; the concatenated form appears in neither file. The port stored
 * "PendingApproval" and fe-vibes-new mapped it back on read
 * (lib/api/realClient.ts ORG_STATUS), so the label was right on screen while
 * the stored value was not — and writes were never translated at all.
 *
 * Scope note: `registration_requests.status` has its own separate vocabulary
 * (OD `TREQ_STATUSES`) in which "PendingApproval" is a legacy pre-lifecycle
 * value kept for old rows (see migration 0038). That enum is deliberately left
 * alone; only `organizations.status` moves here.
 */
const NEW = ["Draft", "Pending Approval", "Active", "Suspended", "Inactive"];
const OLD = ["Draft", "PendingApproval", "Active", "Suspended", "Inactive"];
const quoted = (v: string[]) => v.map((x) => `'${x}'`).join(", ");

export const up: Migration = async ({ context: q }) => {
  const s = q.sequelize;
  await s.query(`CREATE TYPE "enum_organizations_status_new" AS ENUM (${quoted(NEW)})`);
  await s.query(`ALTER TABLE "organizations" ALTER COLUMN "status" DROP DEFAULT`);
  await s.query(`
    ALTER TABLE "organizations"
    ALTER COLUMN "status" TYPE "enum_organizations_status_new"
    USING (CASE "status"::text WHEN 'PendingApproval' THEN 'Pending Approval' ELSE "status"::text END)::"enum_organizations_status_new"
  `);
  await s.query(`DROP TYPE "enum_organizations_status"`);
  await s.query(`ALTER TYPE "enum_organizations_status_new" RENAME TO "enum_organizations_status"`);
  await s.query(`ALTER TABLE "organizations" ALTER COLUMN "status" SET DEFAULT 'Draft'`);
};

export const down: Migration = async ({ context: q }) => {
  const s = q.sequelize;
  await s.query(`CREATE TYPE "enum_organizations_status_old" AS ENUM (${quoted(OLD)})`);
  await s.query(`ALTER TABLE "organizations" ALTER COLUMN "status" DROP DEFAULT`);
  await s.query(`
    ALTER TABLE "organizations"
    ALTER COLUMN "status" TYPE "enum_organizations_status_old"
    USING (CASE "status"::text WHEN 'Pending Approval' THEN 'PendingApproval' ELSE "status"::text END)::"enum_organizations_status_old"
  `);
  await s.query(`DROP TYPE "enum_organizations_status"`);
  await s.query(`ALTER TYPE "enum_organizations_status_old" RENAME TO "enum_organizations_status"`);
  await s.query(`ALTER TABLE "organizations" ALTER COLUMN "status" SET DEFAULT 'Draft'`);
};
