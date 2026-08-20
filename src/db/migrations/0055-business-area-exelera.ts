import type { Migration } from "../migrate";

/**
 * OD `PLATFORM` (index.html:5848-5874) carries five areas, not four: Exelera is a
 * sister operating company with its own live modules (`ex-cab`, `ex-training`,
 * `ex-pcb`). Business registers under that area need the discriminator enum to
 * accept it.
 */
export const up: Migration = async ({ context: q }) => {
  await q.sequelize.query(`ALTER TYPE "enum_business_records_area" ADD VALUE IF NOT EXISTS 'exelera'`);
};

export const down: Migration = async () => {
  // Postgres cannot drop a single enum value in place; leaving the extra value
  // is harmless (no rows are forced onto it).
};
