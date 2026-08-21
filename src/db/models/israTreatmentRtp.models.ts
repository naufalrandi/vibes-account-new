import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { sequelize } from "../sequelize";

/**
 * ISRA + SoA — Group F part 1 (migration 0066): treatment decisions,
 * recommendation snapshot/disposition, added controls, and the RTP + actions
 * + Annex A junction (design doc §2.8 rows 1–7).
 *
 * `IsraRtp.status` is intentionally restricted to Draft/Approved — ISRA's own
 * RTP approval is a single-step transition, not the generic-risk-register
 * seven-function propose/MS/TM/escalate/reject chain (design doc §3.9).
 * `ISRA_TREATMENT_OPTION` is given verbatim in the doc; `ISRA_TREATMENT_STATUS`/
 * `ISRA_TREATMENT_APPROVAL_STATUS`/`ISRA_REC_DISPOSITION` are not spelled out
 * as closed lists and are inferred (flagged in the F-1-impl report) — STRING
 * columns validated at the service layer in a later batch, not DB constraints.
 */
export const ISRA_TREATMENT_OPTION = ["Avoid", "Modify", "Share", "Retain"] as const;
export type IsraTreatmentOption = (typeof ISRA_TREATMENT_OPTION)[number];

export const ISRA_TREATMENT_STATUS = ["Draft", "Active", "Superseded"] as const;
export type IsraTreatmentStatus = (typeof ISRA_TREATMENT_STATUS)[number];

export const ISRA_TREATMENT_APPROVAL_STATUS = ["Pending", "Approved", "Rejected"] as const;
export type IsraTreatmentApprovalStatus = (typeof ISRA_TREATMENT_APPROVAL_STATUS)[number];

export const ISRA_REC_DISPOSITION = ["Already implemented", "Selected for implementation", "Not selected", "Not feasible"] as const;
export type IsraRecDisposition = (typeof ISRA_REC_DISPOSITION)[number];

export const ISRA_RTP_STATUS = ["Draft", "Approved"] as const;
export type IsraRtpStatus = (typeof ISRA_RTP_STATUS)[number];

export const ISRA_RTP_ACTION_STATUS = ["Planned", "In Progress", "Implemented", "Awaiting Verification", "Verified", "Rework", "Cancelled"] as const;
export type IsraRtpActionStatus = (typeof ISRA_RTP_ACTION_STATUS)[number];

export interface IsraAcceptance { justification: string; approver: string; reviewDate: string }
export interface IsraRecommendedControl { annexRef: string; fromVulns: string[] }
export interface IsraFundingLine { amount: number; remark: string }

/** `treatment` + `treatmentHistory[]` unified with an `isCurrent` flag — one
 * active row per `(scenarioId, isCurrent=true)` (invariant enforced at the
 * service layer, a later batch). */
export class IsraScenarioTreatmentDecision extends Model<InferAttributes<IsraScenarioTreatmentDecision>, InferCreationAttributes<IsraScenarioTreatmentDecision>> {
  declare id: CreationOptional<string>;
  declare scenarioId: string;
  declare cycle: CreationOptional<number>;
  declare version: CreationOptional<number>;
  declare option: string;
  declare rationale: string | null;
  declare decidedBy: string | null;
  declare decisionDate: string | null;
  declare approvalStatus: string | null;
  declare approvedBy: string | null;
  declare approvalDate: string | null;
  declare reviewDate: string | null;
  declare acceptance: IsraAcceptance | null;
  declare status: CreationOptional<string>;
  declare needsReview: CreationOptional<boolean>;
  declare isCurrent: CreationOptional<boolean>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
IsraScenarioTreatmentDecision.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    scenarioId: { type: DataTypes.UUID, allowNull: false, field: "scenario_id" },
    cycle: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    option: { type: DataTypes.STRING, allowNull: false },
    rationale: { type: DataTypes.TEXT, allowNull: true },
    decidedBy: { type: DataTypes.STRING, allowNull: true, field: "decided_by" },
    decisionDate: { type: DataTypes.DATEONLY, allowNull: true, field: "decision_date" },
    approvalStatus: { type: DataTypes.STRING, allowNull: true, field: "approval_status" },
    approvedBy: { type: DataTypes.STRING, allowNull: true, field: "approved_by" },
    approvalDate: { type: DataTypes.DATEONLY, allowNull: true, field: "approval_date" },
    reviewDate: { type: DataTypes.DATEONLY, allowNull: true, field: "review_date" },
    acceptance: { type: DataTypes.JSONB, allowNull: true },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Draft" },
    needsReview: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: "needs_review" },
    isCurrent: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: "is_current" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "isra_scenario_treatment_decisions", underscored: true },
);

/** `recSnapshot` + `recSnapshotHistory[]`. Snapshot semantics per
 * `isra-spec.md` §8 — never mutates when the library changes; refresh
 * creates a new row and flips `isCurrent`. */
export class IsraScenarioRecommendationSnapshot extends Model<InferAttributes<IsraScenarioRecommendationSnapshot>, InferCreationAttributes<IsraScenarioRecommendationSnapshot>> {
  declare id: CreationOptional<string>;
  declare scenarioId: string;
  declare controls: CreationOptional<IsraRecommendedControl[]>;
  declare mapVersion: number | null;
  declare generatedAt: CreationOptional<Date>;
  declare isCurrent: CreationOptional<boolean>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
IsraScenarioRecommendationSnapshot.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    scenarioId: { type: DataTypes.UUID, allowNull: false, field: "scenario_id" },
    controls: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    mapVersion: { type: DataTypes.INTEGER, allowNull: true, field: "map_version" },
    generatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: "generated_at" },
    isCurrent: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: "is_current" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "isra_scenario_recommendation_snapshots", underscored: true },
);

/** `recDispositions`. */
export class IsraScenarioRecommendationDisposition extends Model<InferAttributes<IsraScenarioRecommendationDisposition>, InferCreationAttributes<IsraScenarioRecommendationDisposition>> {
  declare id: CreationOptional<string>;
  declare scenarioId: string;
  declare annexRef: string;
  declare disposition: string;
  declare rationale: string | null;
  declare existingControlId: string | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
IsraScenarioRecommendationDisposition.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    scenarioId: { type: DataTypes.UUID, allowNull: false, field: "scenario_id" },
    annexRef: { type: DataTypes.STRING, allowNull: false, field: "annex_ref" },
    disposition: { type: DataTypes.STRING, allowNull: false },
    rationale: { type: DataTypes.TEXT, allowNull: true },
    existingControlId: { type: DataTypes.UUID, allowNull: true, field: "existing_control_id" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "isra_scenario_recommendation_dispositions", underscored: true },
);

/** `addedControls[]` — feeds SoA (design doc §1.4, §4 F-6). */
export class IsraScenarioAddedControl extends Model<InferAttributes<IsraScenarioAddedControl>, InferCreationAttributes<IsraScenarioAddedControl>> {
  declare id: CreationOptional<string>;
  declare scenarioId: string;
  declare annexRef: string;
  declare relatedVulnNames: CreationOptional<string[]>;
  declare source: string | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
IsraScenarioAddedControl.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    scenarioId: { type: DataTypes.UUID, allowNull: false, field: "scenario_id" },
    annexRef: { type: DataTypes.STRING, allowNull: false, field: "annex_ref" },
    relatedVulnNames: { type: DataTypes.JSONB, allowNull: false, defaultValue: [], field: "related_vuln_names" },
    source: { type: DataTypes.STRING, allowNull: true },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "isra_scenario_added_controls", underscored: true },
);

/** Normalizes the *current* `sc.rtp`/`sc.rtpHistory[]` shape. Not a port of
 * the dead `israRtps` collection (design doc §1.4) — a fresh relational
 * model of the live embedded structure. */
export class IsraRtp extends Model<InferAttributes<IsraRtp>, InferCreationAttributes<IsraRtp>> {
  declare id: CreationOptional<string>;
  declare scenarioId: string;
  declare version: CreationOptional<number>;
  declare status: CreationOptional<string>;
  declare approvedBy: string | null;
  declare approvedAt: Date | null;
  declare funding: CreationOptional<IsraFundingLine[]>;
  declare monitoring: string | null;
  declare completionCriteria: string | null;
  declare isCurrent: CreationOptional<boolean>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
IsraRtp.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    scenarioId: { type: DataTypes.UUID, allowNull: false, field: "scenario_id" },
    version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Draft" },
    approvedBy: { type: DataTypes.STRING, allowNull: true, field: "approved_by" },
    approvedAt: { type: DataTypes.DATE, allowNull: true, field: "approved_at" },
    funding: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    monitoring: { type: DataTypes.TEXT, allowNull: true },
    completionCriteria: { type: DataTypes.TEXT, allowNull: true, field: "completion_criteria" },
    isCurrent: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: "is_current" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "isra_rtps", underscored: true },
);

/** `rtp.actions[]`. */
export class IsraRtpAction extends Model<InferAttributes<IsraRtpAction>, InferCreationAttributes<IsraRtpAction>> {
  declare id: CreationOptional<string>;
  declare rtpId: string;
  declare action: string;
  declare owners: CreationOptional<string[]>;
  declare targetDate: string | null;
  declare status: CreationOptional<string>;
  declare evidence: CreationOptional<string[]>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
IsraRtpAction.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    rtpId: { type: DataTypes.UUID, allowNull: false, field: "rtp_id" },
    action: { type: DataTypes.TEXT, allowNull: false },
    owners: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    targetDate: { type: DataTypes.DATEONLY, allowNull: true, field: "target_date" },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Planned" },
    evidence: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "isra_rtp_actions", underscored: true },
);

/** Junction, normalizing `action.addedControlRefs[]` — needed so SoA's third
 * union term (design doc §2.1) is a real join, not a JSONB scan. */
export class IsraRtpActionControl extends Model<InferAttributes<IsraRtpActionControl>, InferCreationAttributes<IsraRtpActionControl>> {
  declare id: CreationOptional<string>;
  declare rtpActionId: string;
  declare annexRef: string;
}
IsraRtpActionControl.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    rtpActionId: { type: DataTypes.UUID, allowNull: false, field: "rtp_action_id" },
    annexRef: { type: DataTypes.STRING, allowNull: false, field: "annex_ref" },
  },
  { sequelize, tableName: "isra_rtp_action_controls", underscored: true, timestamps: false },
);
