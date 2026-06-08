import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * Phase 5 (Support) — the `notifications` table: in-app bell notifications.
 * Each row targets an organization (`org_id`); the Service Owner sees all, every
 * other persona sees only its own org's notifications. `read` is a single
 * broadcast flag (mark-all-read on bell open), mirroring the AXIA reference.
 */
export const up: Migration = async ({ context: q }) => {
  await q.createTable("notifications", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: "organizations", key: "id" },
      onDelete: "CASCADE",
    },
    text: { type: DataTypes.STRING, allowNull: false },
    link: { type: DataTypes.STRING, allowNull: true },
    read: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
  await q.addIndex("notifications", ["org_id"]);
};

export const down: Migration = async ({ context: q }) => {
  await q.dropTable("notifications");
};
