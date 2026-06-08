import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * Phase 1 catalog cutover (removal step). Retires the legacy framework catalog:
 * the `organization_frameworks` subscriptions join, the `framework_families` and
 * `framework_types` lookup tables, and the master-catalog columns on `frameworks`
 * (`family_id`, `code`, `version`, `published_date`, `short_description`,
 * `full_description`). The publish-lifecycle ENUM `status` is replaced by a plain
 * STRING so the AXIA model can use Draft/Active/Archived without a Postgres enum
 * type. The additive group/jurisdictions/description columns from 0010 remain.
 *
 * Dropping `family_id` removes its FK to framework_families; dropping `code`
 * removes the `frameworks_code_unique` constraint — Postgres cascades both.
 */
export const up: Migration = async ({ context: q }) => {
  // Subscriptions join references frameworks; drop it before reshaping frameworks.
  await q.dropTable("organization_frameworks");

  // Drop the family link first so framework_families has no inbound FK.
  await q.removeColumn("frameworks", "family_id");
  await q.dropTable("framework_families");
  await q.dropTable("framework_types");

  // Retire the master-catalog columns superseded by the group-based AXIA shape.
  await q.removeColumn("frameworks", "code");
  await q.removeColumn("frameworks", "version");
  await q.removeColumn("frameworks", "published_date");
  await q.removeColumn("frameworks", "short_description");
  await q.removeColumn("frameworks", "full_description");

  // ENUM("Draft","Published","Archived") -> STRING("Draft"|"Active"|"Archived").
  // Sequelize cannot cast enum -> varchar in place, so drop + recreate the column
  // and remove the now-orphaned Postgres enum type.
  await q.removeColumn("frameworks", "status");
  await q.sequelize.query('DROP TYPE IF EXISTS "enum_frameworks_status"');
  await q.addColumn("frameworks", "status", {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: "Active",
  });
};

export const down: Migration = async ({ context: q }) => {
  // Restore the ENUM status column.
  await q.removeColumn("frameworks", "status");
  await q.addColumn("frameworks", "status", {
    type: DataTypes.ENUM("Draft", "Published", "Archived"),
    allowNull: false,
    defaultValue: "Draft",
  });

  // Restore the master-catalog columns.
  await q.addColumn("frameworks", "full_description", { type: DataTypes.TEXT, allowNull: true });
  await q.addColumn("frameworks", "short_description", { type: DataTypes.TEXT, allowNull: true });
  await q.addColumn("frameworks", "published_date", { type: DataTypes.DATEONLY, allowNull: true });
  await q.addColumn("frameworks", "version", { type: DataTypes.STRING, allowNull: true });
  await q.addColumn("frameworks", "code", { type: DataTypes.STRING, allowNull: true });

  const uuid = { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true };
  const ts = {
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  };

  await q.createTable("framework_types", {
    id: uuid,
    code: { type: DataTypes.STRING, allowNull: false, unique: true },
    name: { type: DataTypes.STRING, allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: true },
    sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    status: { type: DataTypes.ENUM("Active", "Inactive"), allowNull: false, defaultValue: "Active" },
    ...ts,
  });

  await q.createTable("framework_families", {
    id: uuid,
    framework_type_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "framework_types", key: "id" },
      onDelete: "RESTRICT",
    },
    name: { type: DataTypes.STRING, allowNull: false },
    code: { type: DataTypes.STRING, allowNull: false, unique: true },
    sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    status: { type: DataTypes.ENUM("Active", "Inactive"), allowNull: false, defaultValue: "Active" },
    description: { type: DataTypes.TEXT, allowNull: true },
    ...ts,
  });

  await q.addColumn("frameworks", "family_id", {
    type: DataTypes.UUID,
    allowNull: true,
    references: { model: "framework_families", key: "id" },
    onDelete: "RESTRICT",
  });

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
    ...ts,
  });

  await q.addConstraint("organization_frameworks", {
    fields: ["org_id", "framework_id"],
    type: "unique",
    name: "organization_frameworks_org_framework_unique",
  });
  await q.addIndex("framework_types", ["sort_order"]);
  await q.addIndex("framework_families", ["framework_type_id"]);
  await q.addIndex("frameworks", ["family_id"]);
  await q.addIndex("organization_frameworks", ["org_id"]);
};
