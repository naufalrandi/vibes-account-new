import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * Tenant Work Units register (ISO 5.3). Each work unit is scoped to a Site and
 * references Business Processes (processes register) + Digital/Virtual
 * Environments + External Dependencies (scope datasets) by id in JSONB arrays.
 */
export const up: Migration = async ({ context: q }) => {
  await q.createTable("work_units", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: { type: DataTypes.UUID, allowNull: false, references: { model: "organizations", key: "id" }, onDelete: "CASCADE" },
    code: { type: DataTypes.STRING, allowNull: false },
    name: { type: DataTypes.STRING, allowNull: false },
    site_id: { type: DataTypes.UUID, allowNull: true, references: { model: "sites", key: "id" }, onDelete: "SET NULL" },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Applicable" },
    description: { type: DataTypes.TEXT, allowNull: true },
    process_ids: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    env_ids: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    dep_ids: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    created_by: { type: DataTypes.STRING, allowNull: true },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
  await q.sequelize.query('CREATE INDEX IF NOT EXISTS "work_units_org_id" ON "work_units" ("org_id")');
};

export const down: Migration = async ({ context: q }) => {
  await q.dropTable("work_units");
};
