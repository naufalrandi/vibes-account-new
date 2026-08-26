import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * Evaluation area (ISO 9.1 Performance Evaluation, ISO 9.3 Management
 * Review). Two independent tenant-scoped tables, same STRING-status /ISONB
 * -array convention as internal-audit (0018).
 */
export const up: Migration = async ({ context: q }) => {
  await q.createTable("perf_evals", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: { type: DataTypes.UUID, allowNull: false, references: { model: "organizations", key: "id" }, onDelete: "CASCADE" },
    code: { type: DataTypes.STRING, allowNull: false, unique: true },
    period: { type: DataTypes.STRING, allowNull: false },
    date: { type: DataTypes.DATEONLY, allowNull: false },
    owner: { type: DataTypes.STRING, allowNull: false },
    summary: { type: DataTypes.TEXT, allowNull: true },
    indicators: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    created_by: { type: DataTypes.STRING, allowNull: true },
    last_updated_by: { type: DataTypes.STRING, allowNull: true },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
  await q.addIndex("perf_evals", ["org_id"]);

  await q.createTable("management_reviews", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: { type: DataTypes.UUID, allowNull: false, references: { model: "organizations", key: "id" }, onDelete: "CASCADE" },
    code: { type: DataTypes.STRING, allowNull: false, unique: true },
    title: { type: DataTypes.STRING, allowNull: true },
    frameworks: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    date: { type: DataTypes.DATEONLY, allowNull: false },
    time: { type: DataTypes.STRING, allowNull: false },
    tz: { type: DataTypes.STRING, allowNull: false, defaultValue: "Asia/Jakarta" },
    format: { type: DataTypes.STRING, allowNull: false, defaultValue: "Virtual" },
    link: { type: DataTypes.STRING, allowNull: true },
    location: { type: DataTypes.STRING, allowNull: true },
    chairperson: { type: DataTypes.STRING, allowNull: true },
    recorder: { type: DataTypes.STRING, allowNull: true },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Draft" },
    invited: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    external: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    agenda: { type: DataTypes.TEXT, allowNull: true },
    prep: { type: DataTypes.TEXT, allowNull: true },
    materials: { type: DataTypes.TEXT, allowNull: true },
    topics: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    minutes_summary: { type: DataTypes.TEXT, allowNull: true },
    finalized_by: { type: DataTypes.STRING, allowNull: true },
    finalized_date: { type: DataTypes.STRING, allowNull: true },
    version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    created_by: { type: DataTypes.STRING, allowNull: true },
    last_updated_by: { type: DataTypes.STRING, allowNull: true },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
  await q.addIndex("management_reviews", ["org_id"]);
};

export const down: Migration = async ({ context: q }) => {
  await q.dropTable("management_reviews");
  await q.dropTable("perf_evals");
};
