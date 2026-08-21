import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * ISRA + SoA (F-1-impl), Group G — Support: Evidence, the general ISRA audit
 * trail, Scenario Templates, SoA per-control Justifications, and the
 * consolidated org Settings singleton (design doc §2.9).
 *
 * `isra_org_settings` deliberately folds five OD singleton collections
 * (`israSettings`, `israReviewPeriod`, `israExportCfg`, `israCiaSev`,
 * `israConseqCiaRel`) into one row per org — none is ever queried
 * independently of the others (design doc §2.9). `isra_audit` is distinct
 * from `isra_library_audit` (migration 0062) — this is the general ISRA
 * trail, that one only covers the Lt override system.
 *
 * `prev`/`new` in the OD source are stored here as `prev_value`/`new_value`
 * to avoid `new` as a bare SQL/JS identifier — same JSONB before/after
 * snapshot semantics, no `new` reserved-word ambiguity.
 */
export const up: Migration = async ({ context: q }) => {
  const ts = {
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  };

  await q.createTable("isra_evidence", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: { type: DataTypes.UUID, allowNull: false, references: { model: "organizations", key: "id" }, onDelete: "CASCADE" },
    code: { type: DataTypes.STRING, allowNull: false, unique: true },
    scenario_id: { type: DataTypes.UUID, allowNull: true, references: { model: "isra_scenarios", key: "id" }, onDelete: "SET NULL" },
    type: { type: DataTypes.STRING, allowNull: true },
    title: { type: DataTypes.STRING, allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: true },
    file_ref: { type: DataTypes.STRING, allowNull: true },
    submitted_by: { type: DataTypes.STRING, allowNull: true },
    submitted_at: { type: DataTypes.DATE, allowNull: true, defaultValue: DataTypes.NOW },
    related_kind: { type: DataTypes.STRING, allowNull: true },
    related_id: { type: DataTypes.STRING, allowNull: true },
    verification_result: { type: DataTypes.STRING, allowNull: true },
    verified_by: { type: DataTypes.STRING, allowNull: true },
    verified_at: { type: DataTypes.DATE, allowNull: true },
    ...ts,
  });
  await q.addIndex("isra_evidence", ["org_id"]);
  await q.addIndex("isra_evidence", ["scenario_id"]);

  // Append-only — matches this codebase's audit_logs precedent (single `ts`
  // column, no `updated_at`).
  await q.createTable("isra_audit", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: { type: DataTypes.UUID, allowNull: false, references: { model: "organizations", key: "id" }, onDelete: "CASCADE" },
    ts: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    event: { type: DataTypes.STRING, allowNull: false },
    prev_value: { type: DataTypes.JSONB, allowNull: true },
    new_value: { type: DataTypes.JSONB, allowNull: true },
    user: { type: DataTypes.STRING, allowNull: true },
    scenario_id: { type: DataTypes.UUID, allowNull: true, references: { model: "isra_scenarios", key: "id" }, onDelete: "SET NULL" },
    control_id: { type: DataTypes.STRING, allowNull: true },
  });
  await q.addIndex("isra_audit", ["org_id", "ts"]);
  await q.addIndex("isra_audit", ["scenario_id"]);

  await q.createTable("isra_scenario_templates", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: { type: DataTypes.UUID, allowNull: false, references: { model: "organizations", key: "id" }, onDelete: "CASCADE" },
    code: { type: DataTypes.STRING, allowNull: false, unique: true },
    name: { type: DataTypes.STRING, allowNull: false },
    threat_id: { type: DataTypes.STRING, allowNull: false, references: { model: "isra_threat_library", key: "id" }, onDelete: "RESTRICT" },
    vulns: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    cia: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    applies_to_subgroups: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    description: { type: DataTypes.TEXT, allowNull: true },
    source: { type: DataTypes.STRING, allowNull: true },
    ...ts,
  });
  await q.addIndex("isra_scenario_templates", ["org_id"]);
  await q.addIndex("isra_scenario_templates", ["threat_id"]);

  await q.createTable("isra_soa_justifications", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: { type: DataTypes.UUID, allowNull: false, references: { model: "organizations", key: "id" }, onDelete: "CASCADE" },
    annex_ref: { type: DataTypes.STRING, allowNull: false, references: { model: "isra_annex_a_controls", key: "ref" }, onDelete: "RESTRICT" },
    justification: { type: DataTypes.TEXT, allowNull: false },
    updated_by: { type: DataTypes.STRING, allowNull: true },
    ...ts,
  });
  await q.addIndex("isra_soa_justifications", ["org_id", "annex_ref"], { unique: true });

  // 1:1 per org — org_id IS the PK (design doc §2.9: "org_id (PK, 1:1 per org)").
  await q.createTable("isra_org_settings", {
    org_id: { type: DataTypes.UUID, primaryKey: true, references: { model: "organizations", key: "id" }, onDelete: "CASCADE" },
    matrix: { type: DataTypes.JSONB, allowNull: true },
    conseq_method: { type: DataTypes.STRING, allowNull: true },
    require_accept: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    require_higher: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    auto_rec: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    override_allowed: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    residual_enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    review_freq: { type: DataTypes.STRING, allowNull: true },
    review_period_within_days: { type: DataTypes.INTEGER, allowNull: true },
    review_period_above_days: { type: DataTypes.INTEGER, allowNull: true },
    export_columns: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    cia_severity_map: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    conseq_cia_relation: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    ...ts,
  });
};

export const down: Migration = async ({ context: q }) => {
  await q.dropTable("isra_org_settings");
  await q.dropTable("isra_soa_justifications");
  await q.dropTable("isra_scenario_templates");
  await q.dropTable("isra_audit");
  await q.dropTable("isra_evidence");
};
