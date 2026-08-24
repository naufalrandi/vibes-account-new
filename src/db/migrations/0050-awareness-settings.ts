import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * Awareness module governance settings — OD `awSettings` (app.html:25337).
 *
 * The awareness records themselves (programs / topics / campaigns, including the
 * per-recipient acknowledgment + evaluation ledgers materialised on campaign
 * launch) stay 1:1 inside `implementation_records.data` (the established JSONB
 * shape), so the only new storage is the per-org settings singleton: the gate
 * toggles OD keeps on `db.awSettings` (requireMaterial / allowLaunchNoMaterial /
 * requireAck / requireEval / reminders / reminderFreq). One row per
 * organization, JSONB so future toggles need no further migration — the exact
 * `document_settings` pattern (0049).
 */
export const up: Migration = async ({ context: q }) => {
  await q.createTable("awareness_settings", {
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
  await q.dropTable("awareness_settings");
};
