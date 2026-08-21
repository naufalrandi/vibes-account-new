import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { sequelize } from "../sequelize";

/**
 * ISRA + SoA — Group F part 2 (migration 0067): Projected/Actual/rolling
 * Residual + Closure (all 1:1 with a scenario), scenario Cycles (frozen
 * JSONB snapshots), Initiatives + their scenario junction, and the versioned
 * Appetite log (design doc §2.8 rows 8–15).
 *
 * Per design doc §3.8, all three of Projected/Actual/Residual coexist in the
 * live code — Residual is an addition, not a replacement, despite
 * `isra-spec.md`'s superseded-model note. `ISRA_RESIDUAL_BASIS` is given
 * verbatim; `ISRA_CLOSURE_STATUS`/`ISRA_INITIATIVE_STATUS` are inferred
 * (flagged in the F-1-impl report) — STRING columns validated at the
 * service layer in a later batch.
 */
export const ISRA_RESIDUAL_BASIS = ["verified", "projected", "current", "inherent"] as const;
export type IsraResidualBasis = (typeof ISRA_RESIDUAL_BASIS)[number];

export const ISRA_CLOSURE_STATUS = ["Open", "Closed"] as const;
export type IsraClosureStatus = (typeof ISRA_CLOSURE_STATUS)[number];

export const ISRA_INITIATIVE_STATUS = ["Draft", "Active", "Completed", "Cancelled"] as const;
export type IsraInitiativeStatus = (typeof ISRA_INITIATIVE_STATUS)[number];

/** `sc.projected` — still read/written by `isra2Stage`/`isra2ActualForm` in
 * the live code (design doc §4.8) — not dead. 1:1, `scenarioId` IS the PK. */
export class IsraScenarioProjectedResidual extends Model<InferAttributes<IsraScenarioProjectedResidual>, InferCreationAttributes<IsraScenarioProjectedResidual>> {
  declare scenarioId: string;
  declare suggestedL: number | null;
  declare suggestedImpact: number | null;
  declare suggestedScore: number | null;
  declare suggestedBand: string | null;
  declare confirmedL: number | null;
  declare confirmedImpact: number | null;
  declare confirmedScore: number | null;
  declare confirmedBand: string | null;
  declare rtpVersion: number | null;
  declare adequacy: Record<string, unknown> | null;
  declare confirmedAt: Date | null;
  declare confirmedBy: string | null;
  declare needsReview: CreationOptional<boolean>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
IsraScenarioProjectedResidual.init(
  {
    scenarioId: { type: DataTypes.UUID, primaryKey: true, field: "scenario_id" },
    suggestedL: { type: DataTypes.INTEGER, allowNull: true, field: "suggested_l" },
    suggestedImpact: { type: DataTypes.INTEGER, allowNull: true, field: "suggested_impact" },
    suggestedScore: { type: DataTypes.INTEGER, allowNull: true, field: "suggested_score" },
    suggestedBand: { type: DataTypes.STRING, allowNull: true, field: "suggested_band" },
    confirmedL: { type: DataTypes.INTEGER, allowNull: true, field: "confirmed_l" },
    confirmedImpact: { type: DataTypes.INTEGER, allowNull: true, field: "confirmed_impact" },
    confirmedScore: { type: DataTypes.INTEGER, allowNull: true, field: "confirmed_score" },
    confirmedBand: { type: DataTypes.STRING, allowNull: true, field: "confirmed_band" },
    rtpVersion: { type: DataTypes.INTEGER, allowNull: true, field: "rtp_version" },
    adequacy: { type: DataTypes.JSONB, allowNull: true },
    confirmedAt: { type: DataTypes.DATE, allowNull: true, field: "confirmed_at" },
    confirmedBy: { type: DataTypes.STRING, allowNull: true, field: "confirmed_by" },
    needsReview: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: "needs_review" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "isra_scenario_projected_residual", underscored: true },
);

/** `sc.actual` — Actual Residual engine (design doc §3.7): same Method C
 * pooling pipeline as Current Risk, restricted to verified controls only. */
export class IsraScenarioActualResidual extends Model<InferAttributes<IsraScenarioActualResidual>, InferCreationAttributes<IsraScenarioActualResidual>> {
  declare scenarioId: string;
  declare suggestedL: number | null;
  declare suggestedImpact: number | null;
  declare suggestedScore: number | null;
  declare suggestedBand: string | null;
  declare confirmedL: number | null;
  declare confirmedImpact: number | null;
  declare confirmedScore: number | null;
  declare confirmedBand: string | null;
  declare verifiedControlIds: CreationOptional<string[]>;
  declare adequacy: Record<string, unknown> | null;
  declare confirmedAt: Date | null;
  declare confirmedBy: string | null;
  declare needsReview: CreationOptional<boolean>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
IsraScenarioActualResidual.init(
  {
    scenarioId: { type: DataTypes.UUID, primaryKey: true, field: "scenario_id" },
    suggestedL: { type: DataTypes.INTEGER, allowNull: true, field: "suggested_l" },
    suggestedImpact: { type: DataTypes.INTEGER, allowNull: true, field: "suggested_impact" },
    suggestedScore: { type: DataTypes.INTEGER, allowNull: true, field: "suggested_score" },
    suggestedBand: { type: DataTypes.STRING, allowNull: true, field: "suggested_band" },
    confirmedL: { type: DataTypes.INTEGER, allowNull: true, field: "confirmed_l" },
    confirmedImpact: { type: DataTypes.INTEGER, allowNull: true, field: "confirmed_impact" },
    confirmedScore: { type: DataTypes.INTEGER, allowNull: true, field: "confirmed_score" },
    confirmedBand: { type: DataTypes.STRING, allowNull: true, field: "confirmed_band" },
    verifiedControlIds: { type: DataTypes.JSONB, allowNull: false, defaultValue: [], field: "verified_control_ids" },
    adequacy: { type: DataTypes.JSONB, allowNull: true },
    confirmedAt: { type: DataTypes.DATE, allowNull: true, field: "confirmed_at" },
    confirmedBy: { type: DataTypes.STRING, allowNull: true, field: "confirmed_by" },
    needsReview: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: "needs_review" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "isra_scenario_actual_residual", underscored: true },
);

/** `sc.residual` — the newer rolling-cycle single-entry model. Coexists with
 * Projected/Actual, does not replace them (design doc §3.8). */
export class IsraScenarioResidual extends Model<InferAttributes<IsraScenarioResidual>, InferCreationAttributes<IsraScenarioResidual>> {
  declare scenarioId: string;
  declare score: number | null;
  declare band: string | null;
  declare basis: string | null;
  declare assessmentDate: string | null;
  declare assessedBy: string | null;
  declare notes: string | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
IsraScenarioResidual.init(
  {
    scenarioId: { type: DataTypes.UUID, primaryKey: true, field: "scenario_id" },
    score: { type: DataTypes.INTEGER, allowNull: true },
    band: { type: DataTypes.STRING, allowNull: true },
    basis: { type: DataTypes.STRING, allowNull: true },
    assessmentDate: { type: DataTypes.DATEONLY, allowNull: true, field: "assessment_date" },
    assessedBy: { type: DataTypes.STRING, allowNull: true, field: "assessed_by" },
    notes: { type: DataTypes.TEXT, allowNull: true },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "isra_scenario_residual", underscored: true },
);

/** `sc.closure`. */
export class IsraScenarioClosure extends Model<InferAttributes<IsraScenarioClosure>, InferCreationAttributes<IsraScenarioClosure>> {
  declare scenarioId: string;
  declare status: CreationOptional<string>;
  declare closedAt: Date | null;
  declare closedBy: string | null;
  declare reason: string | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
IsraScenarioClosure.init(
  {
    scenarioId: { type: DataTypes.UUID, primaryKey: true, field: "scenario_id" },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Open" },
    closedAt: { type: DataTypes.DATE, allowNull: true, field: "closed_at" },
    closedBy: { type: DataTypes.STRING, allowNull: true, field: "closed_by" },
    reason: { type: DataTypes.TEXT, allowNull: true },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "isra_scenario_closure", underscored: true },
);

/** `sc.cycles[]` — deliberately a JSONB snapshot, not further normalized;
 * these are frozen historical records, never queried by inner field, exactly
 * as OD treats them (`isra2NewCycle` literally copies the live sub-objects
 * verbatim). */
export class IsraScenarioCycle extends Model<InferAttributes<IsraScenarioCycle>, InferCreationAttributes<IsraScenarioCycle>> {
  declare id: CreationOptional<string>;
  declare scenarioId: string;
  declare cycleNumber: number;
  declare snapshot: CreationOptional<Record<string, unknown>>;
  declare archivedAt: CreationOptional<Date>;
}
IsraScenarioCycle.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    scenarioId: { type: DataTypes.UUID, allowNull: false, field: "scenario_id" },
    cycleNumber: { type: DataTypes.INTEGER, allowNull: false, field: "cycle_number" },
    snapshot: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    archivedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: "archived_at" },
  },
  { sequelize, tableName: "isra_scenario_cycles", underscored: true, timestamps: false },
);

/** `israInitiatives`. */
export class IsraInitiative extends Model<InferAttributes<IsraInitiative>, InferCreationAttributes<IsraInitiative>> {
  declare id: CreationOptional<string>;
  declare orgId: string;
  declare code: string;
  declare title: string;
  declare description: string | null;
  declare owner: string | null;
  declare status: CreationOptional<string>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
IsraInitiative.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: false, field: "org_id" },
    code: { type: DataTypes.STRING, allowNull: false },
    title: { type: DataTypes.STRING, allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: true },
    owner: { type: DataTypes.STRING, allowNull: true },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Draft" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "isra_initiatives", underscored: true, indexes: [{ unique: true, fields: ["org_id", "code"] }] },
);

/** Junction (`scenarioIds[]`, M:N per spec). */
export class IsraInitiativeScenario extends Model<InferAttributes<IsraInitiativeScenario>, InferCreationAttributes<IsraInitiativeScenario>> {
  declare id: CreationOptional<string>;
  declare initiativeId: string;
  declare scenarioId: string;
}
IsraInitiativeScenario.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    initiativeId: { type: DataTypes.UUID, allowNull: false, field: "initiative_id" },
    scenarioId: { type: DataTypes.UUID, allowNull: false, field: "scenario_id" },
  },
  { sequelize, tableName: "isra_initiative_scenarios", underscored: true, timestamps: false },
);

/** `israAppetiteLog` — versioned history, append-only (never a singleton;
 * each threshold change adds a row and bumps `riskAppetiteVer`). */
export class IsraAppetiteLog extends Model<InferAttributes<IsraAppetiteLog>, InferCreationAttributes<IsraAppetiteLog>> {
  declare id: CreationOptional<string>;
  declare orgId: string;
  declare version: number;
  declare threshold: number;
  declare effectiveDate: string | null;
  declare approvedBy: string | null;
  declare approvalDate: string | null;
  declare rationale: string | null;
  declare createdAt: CreationOptional<Date>;
}
IsraAppetiteLog.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: false, field: "org_id" },
    version: { type: DataTypes.INTEGER, allowNull: false },
    threshold: { type: DataTypes.INTEGER, allowNull: false },
    effectiveDate: { type: DataTypes.DATEONLY, allowNull: true, field: "effective_date" },
    approvedBy: { type: DataTypes.STRING, allowNull: true, field: "approved_by" },
    approvalDate: { type: DataTypes.DATEONLY, allowNull: true, field: "approval_date" },
    rationale: { type: DataTypes.TEXT, allowNull: true },
    createdAt: DataTypes.DATE,
  },
  { sequelize, tableName: "isra_appetite_log", underscored: true, updatedAt: false },
);
