import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { sequelize } from "../sequelize";

/**
 * ISRA + SoA — Group D (migration 0064): the Asset Risk Mapping tree
 * (Mapping tab, F-3). OD's nested `db.israAssetMap`
 * (Primary→Process→Secondary→Threat→Vuln) normalized into one header + four
 * child levels so each level is independently queryable/indexable
 * (design doc §2.6).
 */
/**
 * Library provenance of an asset reference. OD tags a library row
 * `_source === 'platform'` or `_source === 'tenant'` (`israLtBadge`,
 * js/core.js:16074; `israLtRowMenu`, js/core.js:16063). "tenant" is OD's
 * word for what this port calls an org — the stored value stays OD's.
 * Nothing writes anything but "platform" yet.
 */
export const ISRA_REF_SOURCE = ["platform", "tenant"] as const;
export type IsraRefSource = (typeof ISRA_REF_SOURCE)[number];

/** One row per primary-asset-in-org mapping root. */
export class IsraAssetMap extends Model<InferAttributes<IsraAssetMap>, InferCreationAttributes<IsraAssetMap>> {
  declare id: CreationOptional<string>;
  declare orgId: string;
  declare primaryAssetRef: string;
  declare primaryAssetSource: string;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
IsraAssetMap.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: false, field: "org_id" },
    primaryAssetRef: { type: DataTypes.STRING, allowNull: false, field: "primary_asset_ref" },
    primaryAssetSource: { type: DataTypes.STRING, allowNull: false, field: "primary_asset_source" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "isra_asset_maps", underscored: true },
);

/** One row per Process the primary asset is used in (`usage[]`).
 * `processRef` is a loose string reference to whatever process entity D-11
 * shipped — the design doc does not name a hard FK target for it. */
export class IsraAssetMapUsage extends Model<InferAttributes<IsraAssetMapUsage>, InferCreationAttributes<IsraAssetMapUsage>> {
  declare id: CreationOptional<string>;
  declare assetMapId: string;
  declare processRef: string;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
IsraAssetMapUsage.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    assetMapId: { type: DataTypes.UUID, allowNull: false, field: "asset_map_id" },
    processRef: { type: DataTypes.STRING, allowNull: false, field: "process_ref" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "isra_asset_map_usages", underscored: true },
);

/** One row per Secondary Asset attached under that process (`secondaries[]`). */
export class IsraAssetMapSecondary extends Model<InferAttributes<IsraAssetMapSecondary>, InferCreationAttributes<IsraAssetMapSecondary>> {
  declare id: CreationOptional<string>;
  declare usageId: string;
  declare secondaryAssetRef: string;
  declare secondaryAssetSource: string;
  declare groupId: string | null;
  declare subgroupId: string | null;
  declare baselineVer: CreationOptional<number>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
IsraAssetMapSecondary.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    usageId: { type: DataTypes.UUID, allowNull: false, field: "usage_id" },
    secondaryAssetRef: { type: DataTypes.STRING, allowNull: false, field: "secondary_asset_ref" },
    secondaryAssetSource: { type: DataTypes.STRING, allowNull: false, field: "secondary_asset_source" },
    groupId: { type: DataTypes.STRING, allowNull: true, field: "group_id" },
    subgroupId: { type: DataTypes.STRING, allowNull: true, field: "subgroup_id" },
    baselineVer: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: "baseline_ver" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "isra_asset_map_secondaries", underscored: true },
);

/** One row per Threat attached under that secondary asset. `isBaseline=true`
 * + no user additions ⇒ immutable/non-removable (`isra-spec.md` principle 2). */
export class IsraAssetMapThreat extends Model<InferAttributes<IsraAssetMapThreat>, InferCreationAttributes<IsraAssetMapThreat>> {
  declare id: CreationOptional<string>;
  declare secondaryId: string;
  declare threatId: string;
  declare isBaseline: CreationOptional<boolean>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
IsraAssetMapThreat.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    secondaryId: { type: DataTypes.UUID, allowNull: false, field: "secondary_id" },
    threatId: { type: DataTypes.STRING, allowNull: false, field: "threat_id" },
    isBaseline: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: "is_baseline" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "isra_asset_map_threats", underscored: true },
);

/** One row per Vulnerability grouped under that threat attachment. */
export class IsraAssetMapVuln extends Model<InferAttributes<IsraAssetMapVuln>, InferCreationAttributes<IsraAssetMapVuln>> {
  declare id: CreationOptional<string>;
  declare threatRowId: string;
  declare vulnId: string;
  declare isBaseline: CreationOptional<boolean>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
IsraAssetMapVuln.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    threatRowId: { type: DataTypes.UUID, allowNull: false, field: "threat_row_id" },
    vulnId: { type: DataTypes.STRING, allowNull: false, field: "vuln_id" },
    isBaseline: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: "is_baseline" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "isra_asset_map_vulns", underscored: true },
);
