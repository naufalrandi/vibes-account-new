import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * Adds city/province(state)/postal code to the organization profile, editable
 * from the Org Settings page alongside the existing address/country fields.
 * All columns are nullable so the change is additive and safe for existing rows.
 */
export const up: Migration = async ({ context: q }) => {
  await q.addColumn("organizations", "city", { type: DataTypes.STRING, allowNull: true });
  await q.addColumn("organizations", "state", { type: DataTypes.STRING, allowNull: true });
  await q.addColumn("organizations", "postal_code", { type: DataTypes.STRING, allowNull: true });
};

export const down: Migration = async ({ context: q }) => {
  await q.removeColumn("organizations", "city");
  await q.removeColumn("organizations", "state");
  await q.removeColumn("organizations", "postal_code");
};
