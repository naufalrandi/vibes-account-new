import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { sequelize } from "../sequelize";

/**
 * ISRA + SoA — Group A part 2 (migration 0061): Primary/Secondary asset
 * libraries, the V2 knowledge maps (SA-subgroup→Threat, Threat→Vuln,
 * Vuln→Annex A), the KM publish-state singleton, and the generic RTP
 * action-template library. See `docs/isra-schema-design.md` §2.3 rows 8–14.
 */

export const ISRA_VULN_CONTROL_STATUS = ["Draft", "Under review", "Published"] as const;
export type IsraVulnControlStatus = (typeof ISRA_VULN_CONTROL_STATUS)[number];

export interface IsraKmComment { ts: string; user: string; text: string }

export class IsraPrimaryAssetLibrary extends Model<InferAttributes<IsraPrimaryAssetLibrary>, InferCreationAttributes<IsraPrimaryAssetLibrary>> {
  declare id: string;
  declare name: string;
  declare category: string | null;
  declare groupId: string | null;
  declare subgroupId: string | null;
  declare cia: CreationOptional<Record<string, unknown>>;
  declare privacy: CreationOptional<boolean>;
  declare typicalSecondary: CreationOptional<string[]>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
IsraPrimaryAssetLibrary.init(
  {
    id: { type: DataTypes.STRING, primaryKey: true },
    name: { type: DataTypes.STRING, allowNull: false },
    category: { type: DataTypes.STRING, allowNull: true },
    groupId: { type: DataTypes.STRING, allowNull: true, field: "group_id" },
    subgroupId: { type: DataTypes.STRING, allowNull: true, field: "subgroup_id" },
    cia: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    privacy: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    typicalSecondary: { type: DataTypes.JSONB, allowNull: false, defaultValue: [], field: "typical_secondary" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "isra_primary_asset_library", underscored: true },
);

export class IsraSecondaryAssetLibrary extends Model<InferAttributes<IsraSecondaryAssetLibrary>, InferCreationAttributes<IsraSecondaryAssetLibrary>> {
  declare id: string;
  declare name: string;
  declare groupId: string | null;
  declare subgroupId: string | null;
  declare description: string | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
IsraSecondaryAssetLibrary.init(
  {
    id: { type: DataTypes.STRING, primaryKey: true },
    name: { type: DataTypes.STRING, allowNull: false },
    groupId: { type: DataTypes.STRING, allowNull: true, field: "group_id" },
    subgroupId: { type: DataTypes.STRING, allowNull: true, field: "subgroup_id" },
    description: { type: DataTypes.TEXT, allowNull: true },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "isra_secondary_asset_library", underscored: true },
);

/** Live V2 baseline map (`israMapSaThreatV2`) — the V1 flat predecessor is
 * dead and not ported (design doc §1.2). */
export class IsraKmSaThreat extends Model<InferAttributes<IsraKmSaThreat>, InferCreationAttributes<IsraKmSaThreat>> {
  declare id: string;
  declare subgroupId: string;
  declare groupId: string;
  declare threatId: string;
  declare sources: CreationOptional<string[]>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
IsraKmSaThreat.init(
  {
    id: { type: DataTypes.STRING, primaryKey: true },
    subgroupId: { type: DataTypes.STRING, allowNull: false, field: "subgroup_id" },
    groupId: { type: DataTypes.STRING, allowNull: false, field: "group_id" },
    threatId: { type: DataTypes.STRING, allowNull: false, field: "threat_id" },
    sources: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "isra_km_sa_threat", underscored: true },
);

/** Live V2 baseline map (`israMapThreatVulnV2`). */
export class IsraKmThreatVuln extends Model<InferAttributes<IsraKmThreatVuln>, InferCreationAttributes<IsraKmThreatVuln>> {
  declare id: string;
  declare subgroupId: string;
  declare groupId: string;
  declare threatId: string;
  declare vulnId: string;
  declare sources: CreationOptional<string[]>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
IsraKmThreatVuln.init(
  {
    id: { type: DataTypes.STRING, primaryKey: true },
    subgroupId: { type: DataTypes.STRING, allowNull: false, field: "subgroup_id" },
    groupId: { type: DataTypes.STRING, allowNull: false, field: "group_id" },
    threatId: { type: DataTypes.STRING, allowNull: false, field: "threat_id" },
    vulnId: { type: DataTypes.STRING, allowNull: false, field: "vuln_id" },
    sources: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "isra_km_threat_vuln", underscored: true },
);

/** The Vuln→Annex A junction (platform-owned; per-tenant suppress/add
 * overlay lives in `IsraVulnControlOverlay`, migration 0063 — design doc
 * §1.3). Seeded verbatim from `isra-vuln-control-map.csv` in a later batch. */
export class IsraKmVulnControl extends Model<InferAttributes<IsraKmVulnControl>, InferCreationAttributes<IsraKmVulnControl>> {
  declare id: string;
  declare vulnId: string;
  declare annexRef: string;
  declare role: string | null;
  declare affects: string | null;
  declare strength: string | null;
  declare mechanism: string | null;
  declare references: CreationOptional<string[]>;
  declare status: CreationOptional<string>;
  declare version: CreationOptional<number>;
  declare source: string | null;
  declare reviewer: string | null;
  declare reviewDate: string | null;
  declare comments: CreationOptional<IsraKmComment[]>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
IsraKmVulnControl.init(
  {
    id: { type: DataTypes.STRING, primaryKey: true },
    vulnId: { type: DataTypes.STRING, allowNull: false, field: "vuln_id" },
    annexRef: { type: DataTypes.STRING, allowNull: false, field: "annex_ref" },
    role: { type: DataTypes.STRING, allowNull: true },
    affects: { type: DataTypes.STRING, allowNull: true },
    strength: { type: DataTypes.STRING, allowNull: true },
    mechanism: { type: DataTypes.TEXT, allowNull: true },
    references: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Draft" },
    version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    source: { type: DataTypes.STRING, allowNull: true },
    reviewer: { type: DataTypes.STRING, allowNull: true },
    reviewDate: { type: DataTypes.DATEONLY, allowNull: true, field: "review_date" },
    comments: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "isra_km_vuln_control", underscored: true },
);

/** Singleton publish-state row for the KM review workflow (`isra2KmPublish`). */
export class IsraKmMeta extends Model<InferAttributes<IsraKmMeta>, InferCreationAttributes<IsraKmMeta>> {
  declare id: CreationOptional<string>;
  declare version: CreationOptional<number>;
  declare status: CreationOptional<string>;
  declare publishedAt: Date | null;
  declare publishedBy: string | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
IsraKmMeta.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Draft" },
    publishedAt: { type: DataTypes.DATE, allowNull: true, field: "published_at" },
    publishedBy: { type: DataTypes.STRING, allowNull: true, field: "published_by" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "isra_km_meta", underscored: true },
);

/** Generic RTP action templates, platform-owned; copied (never referenced
 * live) into an org's `IsraRtpAction` on use. */
export class IsraTreatTemplate extends Model<InferAttributes<IsraTreatTemplate>, InferCreationAttributes<IsraTreatTemplate>> {
  declare id: CreationOptional<string>;
  declare vulnId: string;
  declare annexRef: string;
  declare actionTemplate: string;
  declare mechanism: string | null;
  declare notes: string | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
IsraTreatTemplate.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    vulnId: { type: DataTypes.STRING, allowNull: false, field: "vuln_id" },
    annexRef: { type: DataTypes.STRING, allowNull: false, field: "annex_ref" },
    actionTemplate: { type: DataTypes.TEXT, allowNull: false, field: "action_template" },
    mechanism: { type: DataTypes.TEXT, allowNull: true },
    notes: { type: DataTypes.TEXT, allowNull: true },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "isra_treat_templates", underscored: true },
);
