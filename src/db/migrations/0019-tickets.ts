import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * Phase 5 (Support) — the `tickets` table: support tickets raised by any persona.
 * `code` is a unique `TKT-2026-####` business key. `org_id` is the owning org
 * (for scoping); `org_name`/`managed_by` are denormalized display strings.
 * `created_by` is a JSONB {name,email}; `messages`/`activity`/`attachments` are
 * JSONB arrays. `status`/`priority`/`category`/`scope` are STRING (mutable labels).
 */
export const up: Migration = async ({ context: q }) => {
  await q.createTable("tickets", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    code: { type: DataTypes.STRING, allowNull: false, unique: true },
    subject: { type: DataTypes.STRING, allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: false, defaultValue: "" },
    category: { type: DataTypes.STRING, allowNull: false },
    priority: { type: DataTypes.STRING, allowNull: false, defaultValue: "Medium" },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Open" },
    scope: { type: DataTypes.STRING, allowNull: false, defaultValue: "tenant" },
    org_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "organizations", key: "id" },
      onDelete: "CASCADE",
    },
    org_name: { type: DataTypes.STRING, allowNull: false, defaultValue: "" },
    managed_by: { type: DataTypes.STRING, allowNull: true },
    created_by: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    assigned_to: { type: DataTypes.STRING, allowNull: true },
    messages: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    activity: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    attachments: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
  await q.addIndex("tickets", ["org_id"]);
  await q.addIndex("tickets", ["status"]);
};

export const down: Migration = async ({ context: q }) => {
  await q.dropTable("tickets");
};
