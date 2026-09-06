import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * R93 — OD's `db.cabRatePerMd` is a single stored tenant setting (default
 * 8,000,000 IDR) written only by the "Rate per man-day" modal. The port read
 * the rate off each proposal request instead, so nothing stopped a caller
 * pricing a certification proposal at any rate.
 */
export const up: Migration = async ({ context: q }) => {
  await q.createTable("cab_settings", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: { type: DataTypes.UUID, allowNull: false, unique: true, references: { model: "organizations", key: "id" }, onDelete: "CASCADE" },
    rate_per_md: { type: DataTypes.BIGINT, allowNull: true },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: q.sequelize.literal("NOW()") },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: q.sequelize.literal("NOW()") },
  });
};

export const down: Migration = async ({ context: q }) => {
  await q.dropTable("cab_settings");
};
