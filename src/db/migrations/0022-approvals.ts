import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * Approval scheme / gate engine. Custom (C-series) schemes, per-tenant module→
 * scheme assignments, approval-pool membership flags, embedded approval records
 * (snapshot per governed entity), and the tenant self-approval setting. Built-in
 * schemes S0/S1/S2 are defined in code, not stored.
 */
export const up: Migration = async ({ context: q }) => {
  await q.createTable("approval_schemes", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: { type: DataTypes.UUID, allowNull: false, references: { model: "organizations", key: "id" }, onDelete: "CASCADE" },
    code: { type: DataTypes.STRING, allowNull: false },
    name: { type: DataTypes.STRING, allowNull: false },
    kind: { type: DataTypes.STRING, allowNull: false, defaultValue: "custom" },
    self_serve: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    description: { type: DataTypes.TEXT, allowNull: true },
    gates: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
  await q.addIndex("approval_schemes", ["org_id"]);
  await q.addIndex("approval_schemes", ["org_id", "code"], { unique: true });

  await q.createTable("approval_module_map", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: { type: DataTypes.UUID, allowNull: false, references: { model: "organizations", key: "id" }, onDelete: "CASCADE" },
    module_key: { type: DataTypes.STRING, allowNull: false },
    scheme_id: { type: DataTypes.STRING, allowNull: false },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
  await q.addIndex("approval_module_map", ["org_id", "module_key"], { unique: true });

  await q.createTable("approval_pool_members", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: { type: DataTypes.UUID, allowNull: false, references: { model: "organizations", key: "id" }, onDelete: "CASCADE" },
    user_id: { type: DataTypes.UUID, allowNull: false, references: { model: "users", key: "id" }, onDelete: "CASCADE" },
    is_mst: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    mst_priority: { type: DataTypes.STRING, allowNull: false, defaultValue: "required" },
    is_tm: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    tm_final: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
  await q.addIndex("approval_pool_members", ["org_id", "user_id"], { unique: true });

  await q.createTable("approval_records", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: { type: DataTypes.UUID, allowNull: false, references: { model: "organizations", key: "id" }, onDelete: "CASCADE" },
    module: { type: DataTypes.STRING, allowNull: false },
    record_id: { type: DataTypes.UUID, allowNull: false },
    scheme_id: { type: DataTypes.STRING, allowNull: false },
    scheme_name: { type: DataTypes.STRING, allowNull: false },
    self_serve: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    gate_idx: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    gates: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    author_name: { type: DataTypes.STRING, allowNull: true },
    state: { type: DataTypes.STRING, allowNull: false, defaultValue: "active" },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
  await q.addIndex("approval_records", ["org_id", "module", "record_id"], { unique: true });

  await q.createTable("approval_settings", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: { type: DataTypes.UUID, allowNull: false, unique: true, references: { model: "organizations", key: "id" }, onDelete: "CASCADE" },
    self_approval_allowed: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
};

export const down: Migration = async ({ context: q }) => {
  await q.dropTable("approval_settings");
  await q.dropTable("approval_records");
  await q.dropTable("approval_pool_members");
  await q.dropTable("approval_module_map");
  await q.dropTable("approval_schemes");
};
