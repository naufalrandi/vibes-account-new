import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * Internal Documents (controlled documents) workflow — OD `cdSettings`
 * (index.html:12726).
 *
 * The document records themselves stay 1:1 inside `implementation_records.data`
 * (the established JSONB shape), so the only new storage is the per-org
 * document-control settings record: the gate toggles OD keeps on `db.cdSettings`
 * (requireApprover / requireChange / requireFreq / requireOwner /
 * allowEditPublished / enableAck / enableExternal / enableInline). One row per
 * organization, JSONB so future toggles need no further migration.
 */
export const up: Migration = async ({ context: q }) => {
  await q.createTable("document_settings", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: {
      type: DataTypes.UUID, allowNull: false, unique: true,
      references: { model: "organizations", key: "id" }, onDelete: "CASCADE",
    },
    settings: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    created_at: { type: DataTypes.DATE, allowNull: false },
    updated_at: { type: DataTypes.DATE, allowNull: false },
  });
};

export const down: Migration = async ({ context: q }) => {
  await q.dropTable("document_settings");
};
