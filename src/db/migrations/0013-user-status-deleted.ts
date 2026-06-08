import type { Migration } from "../migrate";

/**
 * Adds the `Deleted` value to the `enum_users_status` Postgres type so users can
 * be soft-deleted (status = "Deleted") instead of hard-removed. ADD VALUE is
 * additive and irreversible — Postgres cannot drop an enum value — so `down` is a
 * deliberate no-op. Kept in its own migration because ALTER TYPE ... ADD VALUE is
 * best run alone, separate from the column DDL in 0012.
 */
export const up: Migration = async ({ context: q }) => {
  await q.sequelize.query('ALTER TYPE "enum_users_status" ADD VALUE IF NOT EXISTS \'Deleted\'');
};

export const down: Migration = async () => {
  // Postgres cannot remove an enum value; intentionally a no-op.
};
