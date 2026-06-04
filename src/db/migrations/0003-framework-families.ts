import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * Completes the framework_families table (created as a minimal placeholder in
 * 0002) with the full management schema, and adds a minimal `frameworks` table
 * so the "a family with linked frameworks cannot be deleted" rule is real and
 * testable. framework_families is brand-new and empty everywhere this runs, so
 * the NOT NULL / UNIQUE additions need no backfill.
 */
export const up: Migration = async ({ context: q }) => {
  await q.addColumn("framework_families", "code", {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
  });
  await q.addColumn("framework_families", "sort_order", {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  });
  await q.addColumn("framework_families", "status", {
    type: DataTypes.ENUM("Active", "Inactive"),
    allowNull: false,
    defaultValue: "Active",
  });
  await q.addColumn("framework_families", "description", {
    type: DataTypes.TEXT,
    allowNull: true,
  });

  // Frameworks belong to a family. Only the columns needed to enforce the
  // "cannot delete a family with linked frameworks" rule are modelled here; the
  // full frameworks feature is out of scope for this milestone. RESTRICT mirrors
  // the business rule at the DB level as a backstop to the service check.
  const uuid = { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true };
  await q.createTable("frameworks", {
    id: uuid,
    family_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "framework_families", key: "id" },
      onDelete: "RESTRICT",
    },
    code: { type: DataTypes.STRING, allowNull: true },
    name: { type: DataTypes.STRING, allowNull: false },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });

  await q.addIndex("framework_families", ["sort_order"]);
  await q.addIndex("frameworks", ["family_id"]);
};

export const down: Migration = async ({ context: q }) => {
  await q.dropTable("frameworks");
  await q.removeColumn("framework_families", "description");
  await q.removeColumn("framework_families", "status");
  await q.removeColumn("framework_families", "sort_order");
  await q.removeColumn("framework_families", "code");
};
