import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { sequelize } from "../sequelize";

/** OD `ISRA_REVIEW_PERIOD_DEFAULT` (js/core.js:14767) — review period in MONTHS. */
export const ISRA_REVIEW_PERIOD_DEFAULT = { within: 6, above: 2 } as const;

/** OD `ISRA_RL_NAMES` (js/core.js:13572) — the band names for each level count. */
export const ISRA_RL_NAMES: Record<number, string[]> = {
  2: ["Low", "High"],
  3: ["Low", "Medium", "High"],
  4: ["Low", "Medium", "High", "Critical"],
  5: ["Low", "Medium", "High", "Very High", "Critical"],
  6: ["Low", "Medium", "High", "Very High", "Critical", "Extreme"],
};

/** OD `israRlSetCount` — the level count is clamped to 2..6. */
export function israClampLevelCount(n: number): number {
  return Math.max(2, Math.min(6, Math.round(n) || 5));
}

/** OD `israRiskScheme` — the tenant's band names, falling back to the five-band default. */
export function israRiskScheme(levels: string[] | null | undefined): string[] {
  if (!Array.isArray(levels) || levels.length < 2) return ISRA_RL_NAMES[5];
  const count = israClampLevelCount(levels.length);
  return levels.slice(0, count).map((n, i) => String(n).trim() || ISRA_RL_NAMES[count][i]);
}

/** OD `isra2AddMonthsISO` — add calendar months, returned as `YYYY-MM-DD`. */
export function israAddMonthsIso(from: Date, months: number): string {
  const d = new Date(from.getTime());
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

/**
 * ISRA + SoA — Group G (migration 0068): Evidence, the general ISRA audit
 * trail, Scenario Templates, SoA per-control Justifications, and the
 * consolidated org Settings singleton (design doc §2.9).
 *
 * `IsraOrgSettings` folds five OD singleton collections (`israSettings`,
 * `israReviewPeriod`, `israExportCfg`, `israCiaSev`, `israConseqCiaRel`) into
 * one row per org — none is ever queried independently of the others.
 * `IsraAudit` is distinct from `IsraLibraryAudit` (migration 0062) — this is
 * the general ISRA trail, that one only covers the Lt override system.
 */
export const ISRA_EVIDENCE_RELATED_KIND = ["action", "added", "rtp", "initiative"] as const;
export type IsraEvidenceRelatedKind = (typeof ISRA_EVIDENCE_RELATED_KIND)[number];

export interface IsraCiaSeverityMap { low?: number; medium?: number; high?: number; critical?: number }

/** `israEvidence`. */
export class IsraEvidence extends Model<InferAttributes<IsraEvidence>, InferCreationAttributes<IsraEvidence>> {
  declare id: CreationOptional<string>;
  declare orgId: string;
  declare code: string;
  declare scenarioId: string | null;
  declare type: string | null;
  declare title: string;
  declare description: string | null;
  declare fileRef: string | null;
  declare submittedBy: string | null;
  declare submittedAt: Date | null;
  declare relatedKind: string | null;
  declare relatedId: string | null;
  declare verificationResult: string | null;
  declare verifiedBy: string | null;
  declare verifiedAt: Date | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
IsraEvidence.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: false, field: "org_id" },
    code: { type: DataTypes.STRING, allowNull: false },
    scenarioId: { type: DataTypes.UUID, allowNull: true, field: "scenario_id" },
    type: { type: DataTypes.STRING, allowNull: true },
    title: { type: DataTypes.STRING, allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: true },
    fileRef: { type: DataTypes.STRING, allowNull: true, field: "file_ref" },
    submittedBy: { type: DataTypes.STRING, allowNull: true, field: "submitted_by" },
    submittedAt: { type: DataTypes.DATE, allowNull: true, field: "submitted_at" },
    relatedKind: { type: DataTypes.STRING, allowNull: true, field: "related_kind" },
    relatedId: { type: DataTypes.STRING, allowNull: true, field: "related_id" },
    verificationResult: { type: DataTypes.STRING, allowNull: true, field: "verification_result" },
    verifiedBy: { type: DataTypes.STRING, allowNull: true, field: "verified_by" },
    verifiedAt: { type: DataTypes.DATE, allowNull: true, field: "verified_at" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "isra_evidence", underscored: true, indexes: [{ unique: true, fields: ["org_id", "code"] }] },
);

/** `israAudit` (`isra2Audit`) — general ISRA audit trail, append-only. `prev`/
 * `new` from the OD source are `prevValue`/`newValue` here to avoid `new` as
 * a bare identifier — same before/after JSONB snapshot semantics. */
export class IsraAudit extends Model<InferAttributes<IsraAudit>, InferCreationAttributes<IsraAudit>> {
  declare id: CreationOptional<string>;
  declare orgId: string;
  declare ts: CreationOptional<Date>;
  declare event: string;
  declare prevValue: Record<string, unknown> | null;
  declare newValue: Record<string, unknown> | null;
  declare user: string | null;
  declare scenarioId: string | null;
  declare controlId: string | null;
}
IsraAudit.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: false, field: "org_id" },
    ts: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    event: { type: DataTypes.STRING, allowNull: false },
    prevValue: { type: DataTypes.JSONB, allowNull: true, field: "prev_value" },
    newValue: { type: DataTypes.JSONB, allowNull: true, field: "new_value" },
    user: { type: DataTypes.STRING, allowNull: true },
    scenarioId: { type: DataTypes.UUID, allowNull: true, field: "scenario_id" },
    controlId: { type: DataTypes.STRING, allowNull: true, field: "control_id" },
  },
  { sequelize, tableName: "isra_audit", underscored: true, timestamps: false },
);

/** `israScenarioTemplates`. */
export class IsraScenarioTemplate extends Model<InferAttributes<IsraScenarioTemplate>, InferCreationAttributes<IsraScenarioTemplate>> {
  declare id: CreationOptional<string>;
  declare orgId: string;
  declare code: string;
  declare name: string;
  declare threatId: string;
  declare vulns: CreationOptional<string[]>;
  declare cia: CreationOptional<Record<string, unknown>>;
  declare appliesToSubgroups: CreationOptional<string[]>;
  declare description: string | null;
  declare source: string | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
IsraScenarioTemplate.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: false, field: "org_id" },
    code: { type: DataTypes.STRING, allowNull: false },
    name: { type: DataTypes.STRING, allowNull: false },
    threatId: { type: DataTypes.STRING, allowNull: false, field: "threat_id" },
    vulns: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    cia: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    appliesToSubgroups: { type: DataTypes.JSONB, allowNull: false, defaultValue: [], field: "applies_to_subgroups" },
    description: { type: DataTypes.TEXT, allowNull: true },
    source: { type: DataTypes.STRING, allowNull: true },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "isra_scenario_templates", underscored: true, indexes: [{ unique: true, fields: ["org_id", "code"] }] },
);

/** `db.soaJustify` — SoA's per-control justification free text. Not in OD's
 * original 42-collection list but required (design doc §1.4). */
export class IsraSoaJustification extends Model<InferAttributes<IsraSoaJustification>, InferCreationAttributes<IsraSoaJustification>> {
  declare id: CreationOptional<string>;
  declare orgId: string;
  declare annexRef: string;
  declare justification: string;
  declare updatedBy: string | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
IsraSoaJustification.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: false, field: "org_id" },
    annexRef: { type: DataTypes.STRING, allowNull: false, field: "annex_ref" },
    justification: { type: DataTypes.TEXT, allowNull: false },
    updatedBy: { type: DataTypes.STRING, allowNull: true, field: "updated_by" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "isra_soa_justifications", underscored: true },
);

/** Consolidation of five OD singleton collections (design doc §2.9). 1:1 per
 * org — `orgId` IS the PK, no separate `id` column. */
export class IsraOrgSettings extends Model<InferAttributes<IsraOrgSettings>, InferCreationAttributes<IsraOrgSettings>> {
  declare orgId: string;
  declare matrix: Record<string, unknown> | null;
  declare conseqMethod: string | null;
  declare requireAccept: CreationOptional<boolean>;
  declare requireHigher: CreationOptional<boolean>;
  declare autoRec: CreationOptional<boolean>;
  declare overrideAllowed: CreationOptional<boolean>;
  declare residualEnabled: CreationOptional<boolean>;
  declare reviewFreq: string | null;
  /** OD `ISRA_REVIEW_PERIOD_DEFAULT.within` — months, default 6 (js/core.js:14767). */
  declare reviewPeriodWithinMonths: number | null;
  /** OD `ISRA_REVIEW_PERIOD_DEFAULT.above` — months, default 2. */
  declare reviewPeriodAboveMonths: number | null;
  /**
   * R289 / OD `t.israRiskLevels` — the tenant's own ISRA band names, 2-6 of
   * them, in ascending severity. Null falls back to `ISRA_RL_NAMES[5]`.
   */
  declare riskLevels: string[] | null;
  declare exportColumns: CreationOptional<string[]>;
  declare ciaSeverityMap: CreationOptional<IsraCiaSeverityMap>;
  declare conseqCiaRelation: CreationOptional<Record<string, unknown>>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
IsraOrgSettings.init(
  {
    orgId: { type: DataTypes.UUID, primaryKey: true, field: "org_id" },
    matrix: { type: DataTypes.JSONB, allowNull: true },
    conseqMethod: { type: DataTypes.STRING, allowNull: true, field: "conseq_method" },
    requireAccept: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: "require_accept" },
    requireHigher: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: "require_higher" },
    autoRec: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: "auto_rec" },
    overrideAllowed: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: "override_allowed" },
    residualEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: "residual_enabled" },
    reviewFreq: { type: DataTypes.STRING, allowNull: true, field: "review_freq" },
    reviewPeriodWithinMonths: { type: DataTypes.INTEGER, allowNull: true, field: "review_period_within_months" },
    reviewPeriodAboveMonths: { type: DataTypes.INTEGER, allowNull: true, field: "review_period_above_months" },
    riskLevels: { type: DataTypes.JSONB, allowNull: true, field: "risk_levels" },
    exportColumns: { type: DataTypes.JSONB, allowNull: false, defaultValue: [], field: "export_columns" },
    ciaSeverityMap: { type: DataTypes.JSONB, allowNull: false, defaultValue: {}, field: "cia_severity_map" },
    conseqCiaRelation: { type: DataTypes.JSONB, allowNull: false, defaultValue: {}, field: "conseq_cia_relation" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "isra_org_settings", underscored: true },
);
