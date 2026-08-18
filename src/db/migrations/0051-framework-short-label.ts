import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * Frameworks gain the OD Short Label (index.html:5007) — the compact tag shown
 * in registers (e.g. "9001" for ISO 9001:2015). Blank falls back to the
 * auto-derived standard number (`fwAutoShort`), so the column is nullable.
 */
export const up: Migration = async ({ context: q }) => {
  await q.addColumn("frameworks", "short_label", {
    type: DataTypes.STRING, allowNull: true,
  });
};

export const down: Migration = async ({ context: q }) => {
  await q.removeColumn("frameworks", "short_label");
};
