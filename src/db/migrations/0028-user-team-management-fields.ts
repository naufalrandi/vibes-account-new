import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

export const up: Migration = async ({ context: q }) => {
  await q.sequelize.query('ALTER TYPE "enum_users_status" ADD VALUE IF NOT EXISTS \'Deleted\'');
  await q.addColumn("users", "system", { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });
  await q.addColumn("users", "permission_mode", { type: DataTypes.STRING, allowNull: true });
  await q.addColumn("users", "permissions", { type: DataTypes.JSONB, allowNull: true, defaultValue: [] });
};

export const down: Migration = async ({ context: q }) => {
  await q.removeColumn("users", "permissions");
  await q.removeColumn("users", "permission_mode");
  await q.removeColumn("users", "system");
};
