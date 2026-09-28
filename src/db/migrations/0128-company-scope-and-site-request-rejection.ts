import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * a) `users.company` / `kb_articles.company` — the operating company (AXIA /
 *    Exelera) a person or KB article belongs to, mirroring
 *    `business_records.company`. OD `coUsers()` treats an absent `co` as AXIA,
 *    so the column is nullable and existing rows stay NULL (= default company,
 *    'axia'); only a non-default company is ever stored.
 * b) `site_requests.rejection_reason` — the Service Owner's reason for rejecting
 *    a request, distinct from `reason` (the requester's justification).
 *
 * Guarded on the live column set so a re-run (or a partially applied draft) is a no-op.
 */
const COLUMNS: [table: string, column: string][] = [
  ["users", "company"],
  ["kb_articles", "company"],
  ["site_requests", "rejection_reason"],
];

export const up: Migration = async ({ context: q }) => {
  for (const [table, column] of COLUMNS) {
    const cols = await q.describeTable(table);
    if (column in cols) continue;
    await q.addColumn(table, column, { type: column === "company" ? DataTypes.STRING(40) : DataTypes.TEXT, allowNull: true });
  }
};

export const down: Migration = async ({ context: q }) => {
  for (const [table, column] of COLUMNS) {
    const cols = await q.describeTable(table);
    if (column in cols) await q.removeColumn(table, column);
  }
};
