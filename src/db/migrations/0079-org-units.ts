import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * Enterprise Org Structure — a self-referencing org unit tree, fixed 5-tier
 * depth (A-E, root=A), with per-unit employment-level appointments (`appt`
 * JSONB: level code -> user id). Mirrors the OD prototype's `db.orgUnits`.
 */
export const up: Migration = async ({ context: q }) => {
  await q.createTable("org_units", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: { type: DataTypes.UUID, allowNull: false, references: { model: "organizations", key: "id" }, onDelete: "CASCADE" },
    name: { type: DataTypes.STRING, allowNull: false },
    parent_id: { type: DataTypes.UUID, allowNull: true, references: { model: "org_units", key: "id" }, onDelete: "CASCADE" },
    tier: { type: DataTypes.STRING, allowNull: false, defaultValue: "A" },
    appt: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
  await q.addIndex("org_units", ["org_id"]);
  await q.addIndex("org_units", ["parent_id"]);

  await q.addColumn("users", "org_unit_id", {
    type: DataTypes.UUID, allowNull: true, references: { model: "org_units", key: "id" }, onDelete: "SET NULL",
  });
  await q.addColumn("users", "emp_level", { type: DataTypes.STRING, allowNull: true });
  await q.addIndex("users", ["org_unit_id"]);
};

export const down: Migration = async ({ context: q }) => {
  await q.removeColumn("users", "emp_level");
  await q.removeColumn("users", "org_unit_id");
  await q.dropTable("org_units");
};
