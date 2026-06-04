import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * Adds the `organization_frameworks` join table: an organization's subscriptions
 * to frameworks from the master catalog. A unique (org_id, framework_id) pair
 * enforces "subscribe once" at the DB level as a backstop to the service check.
 * Both FKs CASCADE so removing an org or a framework clears its subscriptions;
 * `subscribed_by_user_id` SET NULL keeps the row if the subscribing user is gone.
 */
export const up: Migration = async ({ context: q }) => {
  await q.createTable("organization_frameworks", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "organizations", key: "id" },
      onDelete: "CASCADE",
    },
    framework_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "frameworks", key: "id" },
      onDelete: "CASCADE",
    },
    subscribed_by_user_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: "users", key: "id" },
      onDelete: "SET NULL",
    },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });

  await q.addConstraint("organization_frameworks", {
    fields: ["org_id", "framework_id"],
    type: "unique",
    name: "organization_frameworks_org_framework_unique",
  });
  await q.addIndex("organization_frameworks", ["org_id"]);
};

export const down: Migration = async ({ context: q }) => {
  await q.dropTable("organization_frameworks");
};
