import type { Migration } from "../migrate";

/**
 * OD persists the pending-account status as `Pending Activation`, with a space:
 * `acSave` (js/core.js:5226) tests membership against
 * ['Pending Activation','Active','Suspended'] and assigns the spaced literal,
 * the Team filter offers it verbatim (:4936), and `seedUsers` (:155) writes it.
 *
 * The port stored "Pending Activation" and fe-vibes-new translated it back on the
 * wire in both directions (lib/api/realClient.ts USER_STATUS /
 * USER_STATUS_TO_API), so the display value was right while the stored value
 * was not — and any consumer that did not go through that shim saw the wrong
 * literal. The shim is removed in the same change.
 *
 * "Inactive" is kept: it is an addition the design does not define, but it is
 * the live contract of the status endpoint (user.controller.ts statusSchema)
 * and removing it is a separate, wider change than this literal fix.
 */
const NEW = ["Pending Activation", "Active", "Suspended", "Inactive", "Deleted"];
const OLD = ["Pending Activation", "Active", "Suspended", "Inactive", "Deleted"];

const quoted = (v: string[]) => v.map((x) => `'${x}'`).join(", ");

export const up: Migration = async ({ context: q }) => {
  const s = q.sequelize;
  await s.query(`CREATE TYPE "enum_users_status_new" AS ENUM (${quoted(NEW)})`);
  await s.query(`ALTER TABLE "users" ALTER COLUMN "status" DROP DEFAULT`);
  await s.query(`
    ALTER TABLE "users"
    ALTER COLUMN "status" TYPE "enum_users_status_new"
    USING (CASE "status"::text WHEN 'PendingActivation' THEN 'Pending Activation' ELSE "status"::text END)::"enum_users_status_new"
  `);
  await s.query(`DROP TYPE "enum_users_status"`);
  await s.query(`ALTER TYPE "enum_users_status_new" RENAME TO "enum_users_status"`);
  await s.query(`ALTER TABLE "users" ALTER COLUMN "status" SET DEFAULT 'Pending Activation'`);
};

export const down: Migration = async ({ context: q }) => {
  const s = q.sequelize;
  await s.query(`CREATE TYPE "enum_users_status_old" AS ENUM (${quoted(OLD)})`);
  await s.query(`ALTER TABLE "users" ALTER COLUMN "status" DROP DEFAULT`);
  await s.query(`
    ALTER TABLE "users"
    ALTER COLUMN "status" TYPE "enum_users_status_old"
    USING (CASE "status"::text WHEN 'Pending Activation' THEN 'PendingActivation' ELSE "status"::text END)::"enum_users_status_old"
  `);
  await s.query(`DROP TYPE "enum_users_status"`);
  await s.query(`ALTER TYPE "enum_users_status_old" RENAME TO "enum_users_status"`);
  await s.query(`ALTER TABLE "users" ALTER COLUMN "status" SET DEFAULT 'PendingActivation'`);
};
