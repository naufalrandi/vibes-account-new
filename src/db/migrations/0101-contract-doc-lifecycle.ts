import type { Migration } from "../migrate";

/**
 * OD's contract-document lifecycle is exactly Draft -> Issued -> Signed:
 * `cdDraftContract` (js/modules.js:5257) creates `{status:'Draft', version:0}`,
 * `cdIssue` (:5390) sets 'Issued' and is the only place `version` increments,
 * `cdRevise` (:5391) returns it to 'Draft', `cdSign` (:5392) sets 'Signed'.
 * `stTag` (:5242) is a three-branch ternary — Signed / Issued / else — and no
 * fourth state exists anywhere in the design.
 *
 * The column shipped with two invented members, "Final" and "Expired", and no
 * writer for either: `createContractDocument`/`updateContractDocument`
 * (personnelContractDoc.service.ts) only pass through what the request carries,
 * and nothing in src/ or the seeders ever supplies them. They are dropped here.
 * Any row that somehow holds one maps to the nearest OD state — "Final" is a
 * finished document, i.e. 'Signed'; "Expired" is a lapsed issued one, i.e.
 * 'Issued' — rather than silently collapsing to 'Draft'.
 *
 * Postgres cannot drop a value from an enum in place, so the column is rebuilt:
 * new type, cast across, swap, drop the old type — the same dance migration
 * 0094 does for `personnel_profiles.employment_status`.
 *
 * `version` also defaulted to 1, so a freshly drafted document already read
 * "v1" before it was ever issued. OD drafts at 0 and lets `cdIssue` produce v1.
 */
const OLD = ["Draft", "Final", "Signed", "Expired", "Issued"];
const NEW = ["Draft", "Issued", "Signed"];

const quoted = (vals: string[]) => vals.map((v) => `'${v}'`).join(", ");

export const up: Migration = async ({ context: q }) => {
  const s = q.sequelize;
  await s.query(`CREATE TYPE "enum_personnel_contract_documents_status_new" AS ENUM (${quoted(NEW)})`);
  await s.query(`ALTER TABLE "personnel_contract_documents" ALTER COLUMN "status" DROP DEFAULT`);
  await s.query(`
    ALTER TABLE "personnel_contract_documents"
    ALTER COLUMN "status" TYPE "enum_personnel_contract_documents_status_new"
    USING (
      CASE "status"::text
        WHEN 'Final' THEN 'Signed'
        WHEN 'Expired' THEN 'Issued'
        WHEN 'Issued' THEN 'Issued'
        WHEN 'Signed' THEN 'Signed'
        ELSE 'Draft'
      END
    )::"enum_personnel_contract_documents_status_new"
  `);
  await s.query(`DROP TYPE "enum_personnel_contract_documents_status"`);
  await s.query(`ALTER TYPE "enum_personnel_contract_documents_status_new" RENAME TO "enum_personnel_contract_documents_status"`);
  await s.query(`ALTER TABLE "personnel_contract_documents" ALTER COLUMN "status" SET DEFAULT 'Draft'`);
  await s.query(`ALTER TABLE "personnel_contract_documents" ALTER COLUMN "version" SET DEFAULT 0`);
};

export const down: Migration = async ({ context: q }) => {
  const s = q.sequelize;
  await s.query(`CREATE TYPE "enum_personnel_contract_documents_status_old" AS ENUM (${quoted(OLD)})`);
  await s.query(`ALTER TABLE "personnel_contract_documents" ALTER COLUMN "status" DROP DEFAULT`);
  await s.query(`
    ALTER TABLE "personnel_contract_documents"
    ALTER COLUMN "status" TYPE "enum_personnel_contract_documents_status_old"
    USING ("status"::text)::"enum_personnel_contract_documents_status_old"
  `);
  await s.query(`DROP TYPE "enum_personnel_contract_documents_status"`);
  await s.query(`ALTER TYPE "enum_personnel_contract_documents_status_old" RENAME TO "enum_personnel_contract_documents_status"`);
  await s.query(`ALTER TABLE "personnel_contract_documents" ALTER COLUMN "status" SET DEFAULT 'Draft'`);
  await s.query(`ALTER TABLE "personnel_contract_documents" ALTER COLUMN "version" SET DEFAULT 1`);
};
