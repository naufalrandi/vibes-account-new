import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * Banks, Holidays, Business Processes and Fiscal Periods — the four
 * Enterprise → Database screens whose `/v1/reference-db/*` endpoints the
 * frontend has always called and the backend never implemented. All four are
 * org-scoped, like every other table in this module.
 */
export const up: Migration = async ({ context: q }) => {
  await q.createTable("reference_banks", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: { type: DataTypes.UUID, allowNull: false },
    country: { type: DataTypes.STRING, allowNull: false, defaultValue: "" },
    country_name: { type: DataTypes.STRING, allowNull: false, defaultValue: "" },
    name: { type: DataTypes.STRING, allowNull: false },
    code: { type: DataTypes.STRING, allowNull: false, defaultValue: "" },
    swift: { type: DataTypes.STRING, allowNull: false, defaultValue: "" },
    type: { type: DataTypes.STRING, allowNull: false, defaultValue: "Commercial" },
    created_at: { type: DataTypes.DATE, allowNull: false },
    updated_at: { type: DataTypes.DATE, allowNull: false },
  });
  await q.addIndex("reference_banks", ["org_id"]);

  await q.createTable("reference_holidays", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: { type: DataTypes.UUID, allowNull: false },
    country: { type: DataTypes.STRING, allowNull: false, defaultValue: "" },
    country_name: { type: DataTypes.STRING, allowNull: false, defaultValue: "" },
    date: { type: DataTypes.STRING, allowNull: false },
    name: { type: DataTypes.STRING, allowNull: false },
    type: { type: DataTypes.STRING, allowNull: false, defaultValue: "Public" },
    day_off: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    created_at: { type: DataTypes.DATE, allowNull: false },
    updated_at: { type: DataTypes.DATE, allowNull: false },
  });
  await q.addIndex("reference_holidays", ["org_id"]);

  await q.createTable("reference_bp_processes", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: { type: DataTypes.UUID, allowNull: false },
    group: { type: DataTypes.STRING, allowNull: false },
    subgroup: { type: DataTypes.STRING, allowNull: false, defaultValue: "General" },
    name: { type: DataTypes.STRING, allowNull: false },
    desc: { type: DataTypes.TEXT, allowNull: false, defaultValue: "" },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Active" },
    created_at: { type: DataTypes.DATE, allowNull: false },
    updated_at: { type: DataTypes.DATE, allowNull: false },
  });
  await q.addIndex("reference_bp_processes", ["org_id"]);

  // One row per org, hence the unique org_id.
  await q.createTable("reference_fiscal_config", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: { type: DataTypes.UUID, allowNull: false, unique: true },
    fy: { type: DataTypes.STRING, allowNull: false },
    start_month: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    period_type: { type: DataTypes.STRING, allowNull: false, defaultValue: "Monthly" },
    periods: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    created_at: { type: DataTypes.DATE, allowNull: false },
    updated_at: { type: DataTypes.DATE, allowNull: false },
  });
};

export const down: Migration = async ({ context: q }) => {
  await q.dropTable("reference_fiscal_config");
  await q.dropTable("reference_bp_processes");
  await q.dropTable("reference_holidays");
  await q.dropTable("reference_banks");
};
