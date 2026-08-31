import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * SOF-325 (SOF-167 gap register) — `isra2ExcForm`'s free-text "Control
 * owner" field (core.js:14723, `C.owner`) has no column on
 * `isra_existing_controls`.
 */
export const up: Migration = async ({ context: q }) => {
  await q.addColumn("isra_existing_controls", "owner", { type: DataTypes.STRING, allowNull: true });
};

export const down: Migration = async ({ context: q }) => {
  await q.removeColumn("isra_existing_controls", "owner");
};
