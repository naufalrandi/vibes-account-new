import type { Migration } from "../migrate";

/**
 * Framework Element status vocabulary aligns to OD (index.html:5303 — the
 * element modal offers Active/Inactive and the list row action toggles them).
 * The enum gains "Inactive"; legacy "Draft"/"Archived" values remain accepted
 * so existing rows keep loading.
 */
export const up: Migration = async ({ context: q }) => {
  await q.sequelize.query(`ALTER TYPE "enum_framework_elements_status" ADD VALUE IF NOT EXISTS 'Inactive'`);
};

export const down: Migration = async () => {
  // Postgres cannot drop a single enum value in place; leaving the extra value
  // is harmless (no rows are forced onto it).
};
