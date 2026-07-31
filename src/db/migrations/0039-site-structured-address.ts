import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * OD's site form captures a structured address — street line, city, state and
 * postal code (`siteAddrOneLine`/`siteAddrFull` join them for display). Both
 * `sites` and the `proposed` payload on `site_requests` collapsed all four into
 * a single `address` string, so the parts could never be read back, filtered on
 * or re-rendered in OD's format.
 *
 * The existing `address` column is kept as the street line rather than dropped:
 * that is what it holds in practice, so no data moves and no round-trip is lost.
 * `site_requests.proposed` is JSONB, so its new keys need no schema change.
 */
const COLUMNS = {
  city: "city",
  state: "state",
  postal_code: "postalCode",
} as const;

export const up: Migration = async ({ context: q }) => {
  for (const column of Object.keys(COLUMNS)) {
    await q.addColumn("sites", column, { type: DataTypes.STRING, allowNull: true });
  }
};

export const down: Migration = async ({ context: q }) => {
  for (const column of Object.keys(COLUMNS)) {
    await q.removeColumn("sites", column);
  }
};
