import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * ISRA + SoA (F-1-impl), Group A part 2 — Primary/Secondary asset libraries,
 * the V2 knowledge maps (SA-subgroup→Threat, Threat→Vuln, Vuln→Annex A), the
 * KM publish-state singleton, and the generic RTP action-template library.
 * See `docs/isra-schema-design.md` §2.3 rows 8–14.
 *
 * `isra_km_sa_threat`/`isra_km_threat_vuln` are the *V2* baseline maps only —
 * the V1 flat-shape predecessors (`israMapSaThreat`/`israMapThreatVuln`) are
 * dead and intentionally not ported (design doc §1.2).
 */
export const up: Migration = async ({ context: q }) => {
  const ts = {
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  };

  await q.createTable("isra_primary_asset_library", {
    id: { type: DataTypes.STRING, primaryKey: true },
    name: { type: DataTypes.STRING, allowNull: false },
    category: { type: DataTypes.STRING, allowNull: true },
    group_id: { type: DataTypes.STRING, allowNull: true, references: { model: "isra_pa_groups", key: "id" }, onDelete: "RESTRICT" },
    subgroup_id: { type: DataTypes.STRING, allowNull: true, references: { model: "isra_pa_subgroups", key: "id" }, onDelete: "RESTRICT" },
    cia: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    privacy: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    typical_secondary: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    ...ts,
  });
  await q.addIndex("isra_primary_asset_library", ["group_id"]);
  await q.addIndex("isra_primary_asset_library", ["subgroup_id"]);

  await q.createTable("isra_secondary_asset_library", {
    id: { type: DataTypes.STRING, primaryKey: true },
    name: { type: DataTypes.STRING, allowNull: false },
    group_id: { type: DataTypes.STRING, allowNull: true, references: { model: "isra_sa_groups", key: "id" }, onDelete: "RESTRICT" },
    subgroup_id: { type: DataTypes.STRING, allowNull: true, references: { model: "isra_sa_subgroups", key: "id" }, onDelete: "RESTRICT" },
    description: { type: DataTypes.TEXT, allowNull: true },
    ...ts,
  });
  await q.addIndex("isra_secondary_asset_library", ["group_id"]);
  await q.addIndex("isra_secondary_asset_library", ["subgroup_id"]);

  await q.createTable("isra_km_sa_threat", {
    id: { type: DataTypes.STRING, primaryKey: true },
    subgroup_id: { type: DataTypes.STRING, allowNull: false, references: { model: "isra_sa_subgroups", key: "id" }, onDelete: "CASCADE" },
    group_id: { type: DataTypes.STRING, allowNull: false, references: { model: "isra_sa_groups", key: "id" }, onDelete: "CASCADE" },
    threat_id: { type: DataTypes.STRING, allowNull: false, references: { model: "isra_threat_library", key: "id" }, onDelete: "RESTRICT" },
    sources: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    ...ts,
  });
  await q.addIndex("isra_km_sa_threat", ["subgroup_id"]);
  await q.addIndex("isra_km_sa_threat", ["threat_id"]);

  await q.createTable("isra_km_threat_vuln", {
    id: { type: DataTypes.STRING, primaryKey: true },
    subgroup_id: { type: DataTypes.STRING, allowNull: false, references: { model: "isra_sa_subgroups", key: "id" }, onDelete: "CASCADE" },
    group_id: { type: DataTypes.STRING, allowNull: false, references: { model: "isra_sa_groups", key: "id" }, onDelete: "CASCADE" },
    threat_id: { type: DataTypes.STRING, allowNull: false, references: { model: "isra_threat_library", key: "id" }, onDelete: "RESTRICT" },
    vuln_id: { type: DataTypes.STRING, allowNull: false, references: { model: "isra_vuln_library", key: "id" }, onDelete: "RESTRICT" },
    sources: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    ...ts,
  });
  await q.addIndex("isra_km_threat_vuln", ["subgroup_id"]);
  await q.addIndex("isra_km_threat_vuln", ["threat_id"]);
  await q.addIndex("isra_km_threat_vuln", ["vuln_id"]);

  // The Vuln→Annex A junction table (platform-owned, tenant-overlaid via
  // isra_vuln_control_overlay in migration 0063 — design doc §1.3).
  await q.createTable("isra_km_vuln_control", {
    id: { type: DataTypes.STRING, primaryKey: true },
    vuln_id: { type: DataTypes.STRING, allowNull: false, references: { model: "isra_vuln_library", key: "id" }, onDelete: "RESTRICT" },
    annex_ref: { type: DataTypes.STRING, allowNull: false, references: { model: "isra_annex_a_controls", key: "ref" }, onDelete: "RESTRICT" },
    role: { type: DataTypes.STRING, allowNull: true },
    affects: { type: DataTypes.STRING, allowNull: true },
    strength: { type: DataTypes.STRING, allowNull: true },
    mechanism: { type: DataTypes.TEXT, allowNull: true },
    references: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Draft" },
    version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    source: { type: DataTypes.STRING, allowNull: true },
    reviewer: { type: DataTypes.STRING, allowNull: true },
    review_date: { type: DataTypes.DATEONLY, allowNull: true },
    comments: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    ...ts,
  });
  await q.addIndex("isra_km_vuln_control", ["vuln_id"]);
  await q.addIndex("isra_km_vuln_control", ["annex_ref"]);

  // Singleton publish-state row for the KM review workflow (isra2KmPublish etc).
  await q.createTable("isra_km_meta", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Draft" },
    published_at: { type: DataTypes.DATE, allowNull: true },
    published_by: { type: DataTypes.STRING, allowNull: true },
    ...ts,
  });

  await q.createTable("isra_treat_templates", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    vuln_id: { type: DataTypes.STRING, allowNull: false, references: { model: "isra_vuln_library", key: "id" }, onDelete: "RESTRICT" },
    annex_ref: { type: DataTypes.STRING, allowNull: false, references: { model: "isra_annex_a_controls", key: "ref" }, onDelete: "RESTRICT" },
    action_template: { type: DataTypes.TEXT, allowNull: false },
    mechanism: { type: DataTypes.TEXT, allowNull: true },
    notes: { type: DataTypes.TEXT, allowNull: true },
    ...ts,
  });
  await q.addIndex("isra_treat_templates", ["vuln_id"]);
  await q.addIndex("isra_treat_templates", ["annex_ref"]);
};

export const down: Migration = async ({ context: q }) => {
  await q.dropTable("isra_treat_templates");
  await q.dropTable("isra_km_meta");
  await q.dropTable("isra_km_vuln_control");
  await q.dropTable("isra_km_threat_vuln");
  await q.dropTable("isra_km_sa_threat");
  await q.dropTable("isra_secondary_asset_library");
  await q.dropTable("isra_primary_asset_library");
};
