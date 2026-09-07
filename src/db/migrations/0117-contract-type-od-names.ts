import type { Migration } from "../migrate";

/**
 * OD `CONTRACT_TYPE_SEED` (js/modules.js:5040-5044) has exactly four contract
 * types: "Permanent", "Fixed Duration", "Internship", "Contractor (SOW)".
 *
 * Migration 0081 created the column with five invented values and 0097 added
 * the two missing OD names alongside them. This drops the three that are not
 * OD's — "Fixed-Term" is OD's "Fixed Duration" under another name,
 * "Outsourced" is its "Contractor (SOW)", and "Probation" was never a contract
 * type at all: OD keeps probation on `contract.probationEnd` inside whatever
 * contract the person holds (js/modules.js:4657/4712), so probationers keep a
 * real contract type and `confirmProbation` moves to gating on the probation
 * end date in the same change.
 *
 * Postgres cannot drop an enum value in place, so the column is rebuilt — the
 * same dance migration 0094 did for `employment_status` on this table.
 */
const OLD = ["Permanent", "Fixed-Term", "Probation", "Internship", "Outsourced", "Fixed Duration", "Contractor (SOW)"];
const NEW = ["Permanent", "Fixed Duration", "Internship", "Contractor (SOW)"];

const quoted = (vals: string[]) => vals.map((v) => `'${v}'`).join(", ");

export const up: Migration = async ({ context: q }) => {
  const s = q.sequelize;
  await s.query(`CREATE TYPE "enum_personnel_profiles_contract_type_new" AS ENUM (${quoted(NEW)})`);
  await s.query(`
    ALTER TABLE "personnel_profiles"
    ALTER COLUMN "contract_type" TYPE "enum_personnel_profiles_contract_type_new"
    USING (
      CASE "contract_type"::text
        WHEN 'Fixed-Term' THEN 'Fixed Duration'
        WHEN 'Outsourced' THEN 'Contractor (SOW)'
        WHEN 'Probation' THEN 'Permanent'
        ELSE "contract_type"::text
      END
    )::"enum_personnel_profiles_contract_type_new"
  `);
  await s.query(`DROP TYPE "enum_personnel_profiles_contract_type"`);
  await s.query(`ALTER TYPE "enum_personnel_profiles_contract_type_new" RENAME TO "enum_personnel_profiles_contract_type"`);
};

export const down: Migration = async ({ context: q }) => {
  const s = q.sequelize;
  await s.query(`CREATE TYPE "enum_personnel_profiles_contract_type_old" AS ENUM (${quoted(OLD)})`);
  await s.query(`
    ALTER TABLE "personnel_profiles"
    ALTER COLUMN "contract_type" TYPE "enum_personnel_profiles_contract_type_old"
    USING ("contract_type"::text)::"enum_personnel_profiles_contract_type_old"
  `);
  await s.query(`DROP TYPE "enum_personnel_profiles_contract_type"`);
  await s.query(`ALTER TYPE "enum_personnel_profiles_contract_type_old" RENAME TO "enum_personnel_profiles_contract_type"`);
};
