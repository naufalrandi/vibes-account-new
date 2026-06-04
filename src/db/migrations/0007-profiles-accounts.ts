import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * Adds the organization-scoped `profiles` and `accounts` tables for the User
 * Management section. Both are owned by an organization via `org_id` (FK →
 * organizations, ON DELETE CASCADE) so deleting an org clears its rows. An index
 * on `org_id` backs the tenant-scoped list queries, which always filter by the
 * authenticated org. Status is an Active/Inactive enum mirroring the convention
 * used by framework types/families.
 */
export const up: Migration = async ({ context: q }) => {
  await q.createTable("profiles", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "organizations", key: "id" },
      onDelete: "CASCADE",
    },
    name: { type: DataTypes.STRING, allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: true },
    status: {
      type: DataTypes.ENUM("Active", "Inactive"),
      allowNull: false,
      defaultValue: "Active",
    },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
  await q.addIndex("profiles", ["org_id"]);

  await q.createTable("accounts", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "organizations", key: "id" },
      onDelete: "CASCADE",
    },
    name: { type: DataTypes.STRING, allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: true },
    provider: { type: DataTypes.STRING, allowNull: true },
    external_id: { type: DataTypes.STRING, allowNull: true },
    role: { type: DataTypes.STRING, allowNull: true },
    status: {
      type: DataTypes.ENUM("Active", "Inactive"),
      allowNull: false,
      defaultValue: "Active",
    },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
  await q.addIndex("accounts", ["org_id"]);
};

export const down: Migration = async ({ context: q }) => {
  await q.dropTable("accounts");
  await q.dropTable("profiles");
};
