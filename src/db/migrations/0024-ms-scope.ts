import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * Management System Scope document — a per-tenant, versioned 6-dimension scope
 * (frameworks/sites/processes/envs/personnel/deps, each an inclusion-state row
 * list) with a baseline snapshot, a Partner→SP re-baseline change request, and
 * supersede/versioning. Dimensions, baseline and pendingChange are JSONB.
 */
export const up: Migration = async ({ context: q }) => {
  await q.createTable("ms_scopes", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: { type: DataTypes.UUID, allowNull: false, references: { model: "organizations", key: "id" }, onDelete: "CASCADE" },
    code: { type: DataTypes.STRING, allowNull: false, unique: true },
    name: { type: DataTypes.STRING, allowNull: false },
    owner: { type: DataTypes.STRING, allowNull: true },
    effective_date: { type: DataTypes.DATEONLY, allowNull: true },
    review_freq: { type: DataTypes.STRING, allowNull: false, defaultValue: "Annually" },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Draft" },
    frameworks: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    sites: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    processes: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    envs: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    personnel: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    deps: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    statement: { type: DataTypes.TEXT, allowNull: true },
    limitations: { type: DataTypes.TEXT, allowNull: true },
    approval_notes: { type: DataTypes.TEXT, allowNull: true },
    framework_relevance: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    approved_by: { type: DataTypes.STRING, allowNull: true },
    approved_date: { type: DataTypes.DATEONLY, allowNull: true },
    version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    baseline: { type: DataTypes.JSONB, allowNull: true },
    pending_change: { type: DataTypes.JSONB, allowNull: true },
    superseded_at: { type: DataTypes.STRING, allowNull: true },
    superseded_by: { type: DataTypes.STRING, allowNull: true },
    superseded_by_version: { type: DataTypes.INTEGER, allowNull: true },
    created_by: { type: DataTypes.STRING, allowNull: true },
    activity: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    comments: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
  await q.addIndex("ms_scopes", ["org_id"]);
  await q.addIndex("ms_scopes", ["org_id", "status"]);
};

export const down: Migration = async ({ context: q }) => {
  await q.dropTable("ms_scopes");
};
