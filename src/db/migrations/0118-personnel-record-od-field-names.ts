import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * Rename the personnel sub-record columns to the names OD actually writes, and
 * drop the one column OD has no counterpart for.
 *
 * Migration 0082 inferred these field names from HR convention because
 * `js/modules.js` was unavailable at port time (see its own provenance note).
 * Read back against the design:
 *
 *  - `personAddDisc` (js/modules.js:5525) writes `{date, type, severity,
 *    action, note}` and `personTabDisc` (js/modules.js:4929) renders date /
 *    type / severity / action. So discipline_type -> type, incident_date ->
 *    date, action_taken -> action, and the invented required `description`
 *    becomes OD's optional `note` (the `di-note` textarea), which until now
 *    mapped to nothing.
 *  - Neither that modal nor the list card has a status, so `status` (STRING
 *    NOT NULL DEFAULT 'Open', vocabulary Open/Resolved/Appealed) is dropped —
 *    it was invented by 0082.
 *  - `personAddPerf` (js/modules.js:5526) writes `{period, rating, reviewer,
 *    note}`, so review_period -> period and comments -> note.
 *
 * `reviewer_id` (added beside the free-text `reviewer` by 0099) is left alone:
 * it is an additive structured link OD has no opinion on.
 */
const RENAMES: Array<[table: string, from: string, to: string]> = [
  ["disciplinary_records", "discipline_type", "type"],
  ["disciplinary_records", "incident_date", "date"],
  ["disciplinary_records", "action_taken", "action"],
  ["disciplinary_records", "description", "note"],
  ["performance_records", "review_period", "period"],
  ["performance_records", "comments", "note"],
];

export const up: Migration = async ({ context: q }) => {
  for (const [table, from, to] of RENAMES) {
    await q.renameColumn(table, from, to);
  }
  await q.removeColumn("disciplinary_records", "status");
};

export const down: Migration = async ({ context: q }) => {
  // Lossy: the dropped status values cannot be recovered, so every existing row
  // comes back at the column's original 'Open' default.
  await q.addColumn("disciplinary_records", "status", {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: "Open",
  });
  for (const [table, from, to] of RENAMES) {
    await q.renameColumn(table, to, from);
  }
};
