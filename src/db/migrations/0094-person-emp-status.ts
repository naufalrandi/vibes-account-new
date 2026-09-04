import type { Migration } from "../migrate";

/**
 * OD `PERSON_EMP_STATUS` (js/modules.js): Onboarding, Active, On Leave,
 * Suspended, Offboarding, Exited, Alumni.
 *
 * The column shipped with four invented values instead. Two of the mappings
 * are straightforward — "Contract Ended" and "Terminated" are both OD's
 * `Exited`, which is the single status OD uses for anyone who has left.
 *
 * "Probation" is the interesting one. OD does not model probation as an
 * employment status at all: someone on probation is *employed*, and OD carries
 * probation on the contract instead (`contractType = 'Probation'` plus
 * `contract.probationEnd`). This table already has that `contract_type` value,
 * so probationers migrate to `Active` and keep their probation on the contract
 * where the rest of the app already looks for it. `confirmProbation` moves to
 * gating on the contract type in the same change.
 *
 * Postgres cannot drop a value from an enum, so the column is rebuilt: new
 * type, cast the data across, swap, drop the old type.
 */
const OLD = ["Probation", "Active", "Contract Ended", "Terminated"];
const NEW = ["Onboarding", "Active", "On Leave", "Suspended", "Offboarding", "Exited", "Alumni"];

const quoted = (vals: string[]) => vals.map((v) => `'${v}'`).join(", ");

export const up: Migration = async ({ context: q }) => {
  const s = q.sequelize;
  await s.query(`CREATE TYPE "enum_personnel_profiles_employment_status_new" AS ENUM (${quoted(NEW)})`);
  await s.query(`
    ALTER TABLE "personnel_profiles"
    ALTER COLUMN "employment_status" TYPE "enum_personnel_profiles_employment_status_new"
    USING (
      CASE "employment_status"::text
        WHEN 'Probation' THEN 'Active'
        WHEN 'Contract Ended' THEN 'Exited'
        WHEN 'Terminated' THEN 'Exited'
        ELSE 'Active'
      END
    )::"enum_personnel_profiles_employment_status_new"
  `);
  await s.query(`DROP TYPE "enum_personnel_profiles_employment_status"`);
  await s.query(`ALTER TYPE "enum_personnel_profiles_employment_status_new" RENAME TO "enum_personnel_profiles_employment_status"`);
};

export const down: Migration = async ({ context: q }) => {
  const s = q.sequelize;
  // Lossy by nature: OD's four extra states have no pre-OD equivalent, so they
  // all land back on 'Active' — the value the old column defaulted to.
  await s.query(`CREATE TYPE "enum_personnel_profiles_employment_status_old" AS ENUM (${quoted(OLD)})`);
  await s.query(`
    ALTER TABLE "personnel_profiles"
    ALTER COLUMN "employment_status" TYPE "enum_personnel_profiles_employment_status_old"
    USING (
      CASE "employment_status"::text
        WHEN 'Exited' THEN 'Contract Ended'
        ELSE 'Active'
      END
    )::"enum_personnel_profiles_employment_status_old"
  `);
  await s.query(`DROP TYPE "enum_personnel_profiles_employment_status"`);
  await s.query(`ALTER TYPE "enum_personnel_profiles_employment_status_old" RENAME TO "enum_personnel_profiles_employment_status"`);
};
