import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * Adds the organization profile fields edited from the Org Settings page:
 * legal name, industry, and a contact block (name, email, phone). `address`
 * already exists from the initial schema. All columns are nullable so the
 * change is additive and safe for existing rows.
 */
export const up: Migration = async ({ context: q }) => {
  await q.addColumn("organizations", "legal_name", { type: DataTypes.STRING, allowNull: true });
  await q.addColumn("organizations", "industry", { type: DataTypes.STRING, allowNull: true });
  await q.addColumn("organizations", "contact_name", { type: DataTypes.STRING, allowNull: true });
  await q.addColumn("organizations", "contact_email", { type: DataTypes.STRING, allowNull: true });
  await q.addColumn("organizations", "contact_phone", { type: DataTypes.STRING, allowNull: true });
};

export const down: Migration = async ({ context: q }) => {
  await q.removeColumn("organizations", "legal_name");
  await q.removeColumn("organizations", "industry");
  await q.removeColumn("organizations", "contact_name");
  await q.removeColumn("organizations", "contact_email");
  await q.removeColumn("organizations", "contact_phone");
};
