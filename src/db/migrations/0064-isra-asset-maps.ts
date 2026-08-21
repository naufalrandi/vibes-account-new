import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * ISRA + SoA (F-1-impl), Group D — the Asset Risk Mapping tree (Mapping tab,
 * F-3). OD's nested `db.israAssetMap` (Primary→Process→Secondary→Threat→Vuln)
 * normalized into one header + four child levels so each level is
 * independently queryable/indexable (design doc §2.6).
 *
 * `primary_asset_ref`/`secondary_asset_ref` are soft references (`_source`
 * discriminates platform vs. org — design doc §2.10); `process_ref` is left a
 * loose string reference to whatever process entity D-11 shipped, since §2.6
 * does not name a hard FK target for it. `threat_id`/`vuln_id` are
 * unambiguously platform-only, so they get real FKs.
 */
export const up: Migration = async ({ context: q }) => {
  const ts = {
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  };

  await q.createTable("isra_asset_maps", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: { type: DataTypes.UUID, allowNull: false, references: { model: "organizations", key: "id" }, onDelete: "CASCADE" },
    primary_asset_ref: { type: DataTypes.STRING, allowNull: false },
    primary_asset_source: { type: DataTypes.STRING, allowNull: false },
    ...ts,
  });
  await q.addIndex("isra_asset_maps", ["org_id"]);

  await q.createTable("isra_asset_map_usages", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    asset_map_id: { type: DataTypes.UUID, allowNull: false, references: { model: "isra_asset_maps", key: "id" }, onDelete: "CASCADE" },
    process_ref: { type: DataTypes.STRING, allowNull: false },
    ...ts,
  });
  await q.addIndex("isra_asset_map_usages", ["asset_map_id"]);

  await q.createTable("isra_asset_map_secondaries", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    usage_id: { type: DataTypes.UUID, allowNull: false, references: { model: "isra_asset_map_usages", key: "id" }, onDelete: "CASCADE" },
    secondary_asset_ref: { type: DataTypes.STRING, allowNull: false },
    secondary_asset_source: { type: DataTypes.STRING, allowNull: false },
    group_id: { type: DataTypes.STRING, allowNull: true },
    subgroup_id: { type: DataTypes.STRING, allowNull: true },
    baseline_ver: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    ...ts,
  });
  await q.addIndex("isra_asset_map_secondaries", ["usage_id"]);

  await q.createTable("isra_asset_map_threats", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    secondary_id: { type: DataTypes.UUID, allowNull: false, references: { model: "isra_asset_map_secondaries", key: "id" }, onDelete: "CASCADE" },
    threat_id: { type: DataTypes.STRING, allowNull: false, references: { model: "isra_threat_library", key: "id" }, onDelete: "RESTRICT" },
    is_baseline: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    ...ts,
  });
  await q.addIndex("isra_asset_map_threats", ["secondary_id"]);
  await q.addIndex("isra_asset_map_threats", ["threat_id"]);

  await q.createTable("isra_asset_map_vulns", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    threat_row_id: { type: DataTypes.UUID, allowNull: false, references: { model: "isra_asset_map_threats", key: "id" }, onDelete: "CASCADE" },
    vuln_id: { type: DataTypes.STRING, allowNull: false, references: { model: "isra_vuln_library", key: "id" }, onDelete: "RESTRICT" },
    is_baseline: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    ...ts,
  });
  await q.addIndex("isra_asset_map_vulns", ["threat_row_id"]);
  await q.addIndex("isra_asset_map_vulns", ["vuln_id"]);
};

export const down: Migration = async ({ context: q }) => {
  await q.dropTable("isra_asset_map_vulns");
  await q.dropTable("isra_asset_map_threats");
  await q.dropTable("isra_asset_map_secondaries");
  await q.dropTable("isra_asset_map_usages");
  await q.dropTable("isra_asset_maps");
};
