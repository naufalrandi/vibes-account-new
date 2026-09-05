import type { Migration } from "../migrate";

/**
 * Baseline conformance: `personnel_profiles.contract_type` could not hold two
 * of OD's four contract-type names.
 *
 * OD `CONTRACT_TYPE_SEED` (js/modules.js:5041-5044) defines exactly four:
 * "Permanent", "Fixed Duration", "Internship", "Contractor (SOW)". Migration
 * 0081 created the enum with "Permanent", "Fixed-Term", "Probation",
 * "Internship", "Outsourced" — so "Fixed Duration" and "Contractor (SOW)"
 * were rejected by the column outright. They are added here.
 *
 * The three port-only members are deliberately left in place: "Probation" is
 * load-bearing for `convertContract`
 * (src/modules/users/personnelProfile.service.ts:208) and the request schema
 * (src/modules/users/personnelProfile.controller.ts:30) still names all five,
 * so removing them is a coordinated change, not an enum edit. Postgres cannot
 * drop an enum value in place anyway — that needs the type recreated and the
 * stored values rewritten ("Fixed-Term" -> "Fixed Duration", "Outsourced" ->
 * "Contractor (SOW)", "Probation" -> "Permanent" plus a probation-end date,
 * which is how OD models it: js/modules.js:5185). Migration 0094 already does
 * exactly that dance for `employment_status` on this table and is the pattern
 * to copy when that follow-up happens.
 *
 * `ADD VALUE IF NOT EXISTS` follows migration 0086, which added 'Issued' to
 * the contract-document status enum the same way.
 *
 * The other enums this pass widened — ISRA scenario status, SA sub-group
 * status, knowledge-map edge status, asset-ref source, and document status —
 * all sit on plain STRING columns (migrations 0065, 0060, 0061, 0064, 0078),
 * so they need no DDL.
 */
export const up: Migration = async ({ context: q }) => {
  await q.sequelize.query(`ALTER TYPE "enum_personnel_profiles_contract_type" ADD VALUE IF NOT EXISTS 'Fixed Duration'`);
  await q.sequelize.query(`ALTER TYPE "enum_personnel_profiles_contract_type" ADD VALUE IF NOT EXISTS 'Contractor (SOW)'`);
};

export const down: Migration = async () => {
  // Postgres cannot drop a single enum value in place; leaving the two OD
  // names is harmless (same reasoning as migration 0086's `down`).
};
