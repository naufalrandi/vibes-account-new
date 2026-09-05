import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { sequelize } from "../sequelize";

/**
 * ISRA + SoA — Group E (migration 0065): Risk Register core (F-4, design doc
 * §2.7). `IsraScenario` (the `israScenarios2` port, design doc §1.1) is the
 * anchor entity of the whole subsystem — every later group hangs off
 * `scenarioId`.
 *
 * `ISRA_SCENARIO_STATUS` is `ISRA_SCEN_STATUS` verbatim (OD js/core.js:13558),
 * in OD's order. `ISRA_EXC_STATUS` is likewise given in full in the design
 * doc §2.7 "Notes" column; `ISRA_EXC_AFFECTS` is still an inferred list and
 * stays flagged in the F-1-impl report. All three back STRING columns
 * validated at the service layer, not DB enums (migration 0065), so the
 * membership above changes without a migration.
 */
/** OD `ISRA_SCEN_STATUS` — js/core.js:13558. */
export const ISRA_SCENARIO_STATUS = [
  "Draft", "Assessed", "Treatment Required", "Treatment Planned", "Treatment In Progress",
  "Pending Residual Review", "Accepted", "Monitoring", "Closed", "Archived",
] as const;
export type IsraScenarioStatus = (typeof ISRA_SCENARIO_STATUS)[number];

export const ISRA_CONSEQ_AREAS = ["life", "privacy", "skills", "ops", "deadlines", "financial", "market", "reputation", "legal", "contracts", "parties", "environment"] as const;
export type IsraConseqArea = (typeof ISRA_CONSEQ_AREAS)[number];

export const ISRA_EXC_STATUS = ["Implemented", "Implemented and Effective", "Partially Implemented", "Planned", "Not Implemented", "Not Applicable"] as const;
export type IsraExcStatus = (typeof ISRA_EXC_STATUS)[number];

export const ISRA_EXC_AFFECTS = ["likelihood", "impact", "both"] as const;
export type IsraExcAffects = (typeof ISRA_EXC_AFFECTS)[number];

export interface IsraCia { c?: boolean; i?: boolean; a?: boolean }
export interface IsraImpactOverride { severity: number; justification: string; by: string; at: string }
export interface IsraActivityEntry { ts: string; user: string; action: string; summary?: string }
export interface IsraComment { ts: string; user: string; text: string }
/** The 7 display-only attrs (`ISRA2_CEFF`) — feeds only the UI "assessment %"
 * badge, never the Current/Actual Risk scoring engine (design doc §3.4). */
export interface IsraCeff { maturity?: number; evidence?: number; coverage?: number; consistency?: number; automation?: number; frequency?: number; testing?: number }
export interface IsraMaturity { gov?: number; doc?: number; impl?: number; mon?: number; comp?: number }

/** `israScenarios2` — the anchor entity. `primaryAssetRef`/`secondaryAssetRef`
 * are soft references (design doc §2.10); `threatId` is unambiguously
 * platform-only and gets a real FK. */
export class IsraScenario extends Model<InferAttributes<IsraScenario>, InferCreationAttributes<IsraScenario>> {
  declare id: CreationOptional<string>;
  declare orgId: string;
  declare code: string;
  declare primaryAssetRef: string;
  declare primaryAssetSource: string;
  declare processRef: string | null;
  declare secondaryAssetRef: string;
  declare secondaryAssetSource: string;
  declare threatId: string;
  declare title: string;
  declare status: CreationOptional<string>;
  declare cia: CreationOptional<IsraCia>;
  declare impactOverride: IsraImpactOverride | null;
  declare inherentL: CreationOptional<number>;
  /** `isra2LikeNoteEdit`'s inherent-likelihood justification (core.js:14576). */
  declare likelihoodNote: CreationOptional<string | null>;
  /** `isra2CiaDescEdit`'s per-CIA-letter loss context (core.js:14515). */
  declare ciaDesc: CreationOptional<{ c?: string; i?: string; a?: string }>;
  declare evalCycle: CreationOptional<number>;
  declare reviewDue: string | null;
  declare createdBy: string | null;
  declare activity: CreationOptional<IsraActivityEntry[]>;
  declare comments: CreationOptional<IsraComment[]>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
IsraScenario.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: false, field: "org_id" },
    code: { type: DataTypes.STRING, allowNull: false },
    primaryAssetRef: { type: DataTypes.STRING, allowNull: false, field: "primary_asset_ref" },
    primaryAssetSource: { type: DataTypes.STRING, allowNull: false, field: "primary_asset_source" },
    processRef: { type: DataTypes.STRING, allowNull: true, field: "process_ref" },
    secondaryAssetRef: { type: DataTypes.STRING, allowNull: false, field: "secondary_asset_ref" },
    secondaryAssetSource: { type: DataTypes.STRING, allowNull: false, field: "secondary_asset_source" },
    threatId: { type: DataTypes.STRING, allowNull: false, field: "threat_id" },
    title: { type: DataTypes.STRING, allowNull: false },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Draft" },
    cia: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    impactOverride: { type: DataTypes.JSONB, allowNull: true, field: "impact_override" },
    inherentL: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1, field: "inherent_l" },
    likelihoodNote: { type: DataTypes.TEXT, allowNull: true, field: "likelihood_note" },
    ciaDesc: { type: DataTypes.JSONB, allowNull: false, defaultValue: {}, field: "cia_desc" },
    evalCycle: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1, field: "eval_cycle" },
    reviewDue: { type: DataTypes.DATEONLY, allowNull: true, field: "review_due" },
    createdBy: { type: DataTypes.STRING, allowNull: true, field: "created_by" },
    activity: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    comments: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "isra_scenarios", underscored: true },
);

/** Junction: `includedVulns[]` — the scenario's chosen pathway subset. Pure
 * junction, matching the `ElementRequirementXref` precedent (no timestamps). */
export class IsraScenarioVuln extends Model<InferAttributes<IsraScenarioVuln>, InferCreationAttributes<IsraScenarioVuln>> {
  declare id: CreationOptional<string>;
  declare scenarioId: string;
  declare vulnId: string;
}
IsraScenarioVuln.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    scenarioId: { type: DataTypes.UUID, allowNull: false, field: "scenario_id" },
    vulnId: { type: DataTypes.STRING, allowNull: false, field: "vuln_id" },
  },
  { sequelize, tableName: "isra_scenario_vulns", underscored: true, timestamps: false },
);

/** `potentialImpacts[]` — the 12-area weighted-severity inputs (design doc §3.2). */
export class IsraScenarioPotentialImpact extends Model<InferAttributes<IsraScenarioPotentialImpact>, InferCreationAttributes<IsraScenarioPotentialImpact>> {
  declare id: CreationOptional<string>;
  declare scenarioId: string;
  declare area: string;
  declare severity: number;
  declare note: string;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
IsraScenarioPotentialImpact.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    scenarioId: { type: DataTypes.UUID, allowNull: false, field: "scenario_id" },
    area: { type: DataTypes.STRING, allowNull: false },
    severity: { type: DataTypes.INTEGER, allowNull: false },
    note: { type: DataTypes.TEXT, allowNull: false },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "isra_scenario_potential_impacts", underscored: true },
);

/** `israExistingControls`. */
export class IsraExistingControl extends Model<InferAttributes<IsraExistingControl>, InferCreationAttributes<IsraExistingControl>> {
  declare id: CreationOptional<string>;
  declare orgId: string;
  declare scenarioId: string;
  declare title: string;
  declare description: string | null;
  declare status: CreationOptional<string>;
  declare affects: string | null;
  declare objective: string | null;
  /** `isra2ExcForm`'s free-text "Control owner" (core.js:14723, `C.owner`). */
  declare owner: string | null;
  declare ceff: CreationOptional<IsraCeff>;
  declare maturity: CreationOptional<IsraMaturity>;
  declare maturityByRef: CreationOptional<Record<string, number>>;
  declare overridePct: number | null;
  declare verified: CreationOptional<boolean>;
  declare verifiedEffectiveness: number | null;
  declare evidence: CreationOptional<string[]>;
  declare createdBy: string | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
IsraExistingControl.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: false, field: "org_id" },
    scenarioId: { type: DataTypes.UUID, allowNull: false, field: "scenario_id" },
    title: { type: DataTypes.STRING, allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: true },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Planned" },
    affects: { type: DataTypes.STRING, allowNull: true },
    objective: { type: DataTypes.STRING, allowNull: true },
    owner: { type: DataTypes.STRING, allowNull: true },
    ceff: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    maturity: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    maturityByRef: { type: DataTypes.JSONB, allowNull: false, defaultValue: {}, field: "maturity_by_ref" },
    overridePct: { type: DataTypes.FLOAT, allowNull: true, field: "override_pct" },
    verified: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    verifiedEffectiveness: { type: DataTypes.FLOAT, allowNull: true, field: "verified_effectiveness" },
    evidence: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    createdBy: { type: DataTypes.STRING, allowNull: true, field: "created_by" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "isra_existing_controls", underscored: true },
);

/** Junction — M:N per spec §4; makes SoA's `existingControls.annexRefs`
 * union queryable in SQL (design doc §2.1). */
export class IsraExistingControlAnnexRef extends Model<InferAttributes<IsraExistingControlAnnexRef>, InferCreationAttributes<IsraExistingControlAnnexRef>> {
  declare id: CreationOptional<string>;
  declare existingControlId: string;
  declare annexRef: string;
}
IsraExistingControlAnnexRef.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    existingControlId: { type: DataTypes.UUID, allowNull: false, field: "existing_control_id" },
    annexRef: { type: DataTypes.STRING, allowNull: false, field: "annex_ref" },
  },
  { sequelize, tableName: "isra_existing_control_annex_refs", underscored: true, timestamps: false },
);

/** `sc.current` — 1:1 with `IsraScenario` (`scenarioId` IS the PK). Method C
 * ("C-capped-quality-gated") is the sole shipped scoring engine (design doc
 * §3.4); `confirmed*` auto-adopts `suggested*` on every recalculation, no
 * manual confirm step (§3.6). */
export class IsraScenarioCurrentRisk extends Model<InferAttributes<IsraScenarioCurrentRisk>, InferCreationAttributes<IsraScenarioCurrentRisk>> {
  declare scenarioId: string;
  declare method: CreationOptional<string>;
  declare methodVer: CreationOptional<number>;
  declare calcAt: Date | null;
  declare iL: number | null;
  declare iImpact: number | null;
  declare suggestedL: number | null;
  declare suggestedImpact: number | null;
  declare suggestedScore: number | null;
  declare suggestedBand: string | null;
  declare confirmedL: number | null;
  declare confirmedImpact: number | null;
  declare confirmedScore: number | null;
  declare confirmedBand: string | null;
  declare confirmedAt: Date | null;
  declare confirmedBy: string | null;
  declare overrideRationale: string | null;
  declare needsReview: CreationOptional<boolean>;
  declare eligibleControlIds: CreationOptional<string[]>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
IsraScenarioCurrentRisk.init(
  {
    scenarioId: { type: DataTypes.UUID, primaryKey: true, field: "scenario_id" },
    method: { type: DataTypes.STRING, allowNull: false, defaultValue: "C-capped-quality-gated" },
    methodVer: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1, field: "method_ver" },
    calcAt: { type: DataTypes.DATE, allowNull: true, field: "calc_at" },
    iL: { type: DataTypes.INTEGER, allowNull: true, field: "i_l" },
    iImpact: { type: DataTypes.INTEGER, allowNull: true, field: "i_impact" },
    suggestedL: { type: DataTypes.INTEGER, allowNull: true, field: "suggested_l" },
    suggestedImpact: { type: DataTypes.INTEGER, allowNull: true, field: "suggested_impact" },
    suggestedScore: { type: DataTypes.INTEGER, allowNull: true, field: "suggested_score" },
    suggestedBand: { type: DataTypes.STRING, allowNull: true, field: "suggested_band" },
    confirmedL: { type: DataTypes.INTEGER, allowNull: true, field: "confirmed_l" },
    confirmedImpact: { type: DataTypes.INTEGER, allowNull: true, field: "confirmed_impact" },
    confirmedScore: { type: DataTypes.INTEGER, allowNull: true, field: "confirmed_score" },
    confirmedBand: { type: DataTypes.STRING, allowNull: true, field: "confirmed_band" },
    confirmedAt: { type: DataTypes.DATE, allowNull: true, field: "confirmed_at" },
    confirmedBy: { type: DataTypes.STRING, allowNull: true, field: "confirmed_by" },
    overrideRationale: { type: DataTypes.TEXT, allowNull: true, field: "override_rationale" },
    needsReview: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: "needs_review" },
    eligibleControlIds: { type: DataTypes.JSONB, allowNull: false, defaultValue: [], field: "eligible_control_ids" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "isra_scenario_current_risk", underscored: true },
);
