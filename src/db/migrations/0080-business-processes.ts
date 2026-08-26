import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * Tenant Business Processes register (ISO 4.4 — process approach) + queryable
 * per-step child table (steps carry responsible/resources/KPI/roleId/workUnit,
 * and risks foreign-key to stepId — see risk.processId/risk.stepId, 0070).
 */
export const up: Migration = async ({ context: q }) => {
  await q.createTable("business_processes", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: { type: DataTypes.UUID, allowNull: false, references: { model: "organizations", key: "id" }, onDelete: "CASCADE" },
    code: { type: DataTypes.STRING, allowNull: false },
    catalog_key: { type: DataTypes.STRING, allowNull: true },
    name: { type: DataTypes.STRING, allowNull: false },
    group: { type: DataTypes.STRING, allowNull: true },
    description: { type: DataTypes.TEXT, allowNull: true },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Active" },
    source_type: { type: DataTypes.STRING, allowNull: false, defaultValue: "Tenant Created" },
    created_by: { type: DataTypes.STRING, allowNull: true },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
  await q.sequelize.query('CREATE INDEX IF NOT EXISTS "business_processes_org_id" ON "business_processes" ("org_id")');
  // Backs wuEnsureBps()'s idempotent match-by-catalog-entry (one merged row per org per catalog key).
  await q.sequelize.query('CREATE UNIQUE INDEX IF NOT EXISTS "business_processes_org_catalog_key" ON "business_processes" ("org_id", "catalog_key") WHERE "catalog_key" IS NOT NULL');

  await q.createTable("business_process_steps", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: { type: DataTypes.UUID, allowNull: false, references: { model: "organizations", key: "id" }, onDelete: "CASCADE" },
    process_id: { type: DataTypes.UUID, allowNull: false, references: { model: "business_processes", key: "id" }, onDelete: "CASCADE" },
    seq: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    name: { type: DataTypes.STRING, allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: true },
    responsible: { type: DataTypes.STRING, allowNull: true },
    resources: { type: DataTypes.TEXT, allowNull: true },
    kpi: { type: DataTypes.TEXT, allowNull: true },
    role_id: { type: DataTypes.UUID, allowNull: true, references: { model: "role_templates", key: "id" }, onDelete: "SET NULL" },
    work_unit_id: { type: DataTypes.UUID, allowNull: true, references: { model: "work_units", key: "id" }, onDelete: "SET NULL" },
    next: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
  await q.sequelize.query('CREATE INDEX IF NOT EXISTS "business_process_steps_org_id" ON "business_process_steps" ("org_id")');
  await q.sequelize.query('CREATE INDEX IF NOT EXISTS "business_process_steps_process_id" ON "business_process_steps" ("process_id")');
};

export const down: Migration = async ({ context: q }) => {
  await q.dropTable("business_process_steps");
  await q.dropTable("business_processes");
};
