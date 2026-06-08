import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * Phase 2 (Organization & Team) data foundation — additive. Adds the AXIA Org
 * Profile fields to `organizations` (tax id + branding/defaults JSONB blobs),
 * the per-user team/permission metadata to `users` (system flag, permission mode,
 * permissions array), and the `org_signatories` table. All columns are nullable
 * or defaulted so the change is safe for existing rows; the app keeps working.
 *
 * The `users.status` enum gains its `Deleted` value in the separate, non-
 * transactional migration 0013 (ALTER TYPE ... ADD VALUE cannot run in a
 * transaction alongside other DDL).
 */
export const up: Migration = async ({ context: q }) => {
  await q.addColumn("organizations", "tax_id", { type: DataTypes.STRING, allowNull: true });
  await q.addColumn("organizations", "branding", { type: DataTypes.JSONB, allowNull: true });
  await q.addColumn("organizations", "defaults", { type: DataTypes.JSONB, allowNull: true });

  await q.addColumn("users", "system", { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });
  await q.addColumn("users", "permission_mode", { type: DataTypes.STRING, allowNull: true });
  await q.addColumn("users", "permissions", { type: DataTypes.JSONB, allowNull: true, defaultValue: [] });

  await q.createTable("org_signatories", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "organizations", key: "id" },
      onDelete: "CASCADE",
    },
    full_name: { type: DataTypes.STRING, allowNull: false },
    title: { type: DataTypes.STRING, allowNull: false },
    email: { type: DataTypes.STRING, allowNull: false },
    signature_image: { type: DataTypes.STRING, allowNull: true },
    status: { type: DataTypes.ENUM("Active", "Inactive"), allowNull: false, defaultValue: "Active" },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
  await q.addIndex("org_signatories", ["org_id"]);
};

export const down: Migration = async ({ context: q }) => {
  await q.dropTable("org_signatories");
  await q.removeColumn("users", "permissions");
  await q.removeColumn("users", "permission_mode");
  await q.removeColumn("users", "system");
  await q.removeColumn("organizations", "defaults");
  await q.removeColumn("organizations", "branding");
  await q.removeColumn("organizations", "tax_id");
};
