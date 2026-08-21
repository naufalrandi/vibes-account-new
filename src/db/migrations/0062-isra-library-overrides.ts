import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * ISRA + SoA (F-1-impl), Group B — org-level library customization (the "Lt"
 * system, design doc §2.4). Applies to exactly four `libType`s: primary,
 * secondary, threat, vuln (Annex A controls use the separate, simpler
 * mechanism in migration 0063). `platform_item_id`/`item_key` are soft
 * references (design doc §2.10) — the target table depends on `lib_type`, so
 * no single hard FK can express it.
 */
export const ISRA_LIB_TYPES = ["primary", "secondary", "threat", "vuln"] as const;

export const up: Migration = async ({ context: q }) => {
  const ts = {
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  };

  await q.createTable("isra_library_overrides", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: { type: DataTypes.UUID, allowNull: false, references: { model: "organizations", key: "id" }, onDelete: "CASCADE" },
    lib_type: { type: DataTypes.STRING, allowNull: false },
    platform_item_id: { type: DataTypes.STRING, allowNull: false },
    fields: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    override_version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    base_platform_version: { type: DataTypes.INTEGER, allowNull: true },
    history: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    ...ts,
  });
  await q.addIndex("isra_library_overrides", ["org_id"]);
  await q.addIndex("isra_library_overrides", ["org_id", "lib_type", "platform_item_id"], { unique: true });

  await q.createTable("isra_library_items", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: { type: DataTypes.UUID, allowNull: false, references: { model: "organizations", key: "id" }, onDelete: "CASCADE" },
    lib_type: { type: DataTypes.STRING, allowNull: false },
    tenant_item_id: { type: DataTypes.STRING, allowNull: false },
    name: { type: DataTypes.STRING, allowNull: false },
    group_id: { type: DataTypes.STRING, allowNull: true },
    subgroup_id: { type: DataTypes.STRING, allowNull: true },
    description: { type: DataTypes.TEXT, allowNull: true },
    custom_fields: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    ...ts,
  });
  await q.addIndex("isra_library_items", ["org_id"]);
  await q.addIndex("isra_library_items", ["org_id", "lib_type", "tenant_item_id"], { unique: true });

  await q.createTable("isra_library_archive", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: { type: DataTypes.UUID, allowNull: false, references: { model: "organizations", key: "id" }, onDelete: "CASCADE" },
    lib_type: { type: DataTypes.STRING, allowNull: false },
    item_key: { type: DataTypes.STRING, allowNull: false },
    ...ts,
  });
  await q.addIndex("isra_library_archive", ["org_id"]);
  await q.addIndex("isra_library_archive", ["org_id", "lib_type", "item_key"], { unique: true });

  // Append-only, matching this codebase's audit_logs/login_history precedent
  // (a single `ts` column, no `updated_at` — see 0018/audit_logs).
  await q.createTable("isra_library_audit", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: { type: DataTypes.UUID, allowNull: false, references: { model: "organizations", key: "id" }, onDelete: "CASCADE" },
    ts: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    actor: { type: DataTypes.STRING, allowNull: true },
    action: { type: DataTypes.STRING, allowNull: false },
    lib_type: { type: DataTypes.STRING, allowNull: false },
    key: { type: DataTypes.STRING, allowNull: true },
    detail: { type: DataTypes.JSONB, allowNull: true },
  });
  await q.addIndex("isra_library_audit", ["org_id", "ts"]);
};

export const down: Migration = async ({ context: q }) => {
  await q.dropTable("isra_library_audit");
  await q.dropTable("isra_library_archive");
  await q.dropTable("isra_library_items");
  await q.dropTable("isra_library_overrides");
};
