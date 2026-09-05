import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { sequelize } from "../sequelize";

/**
 * ISRA + SoA — Group F part 1 (migration 0066): treatment decisions,
 * recommendation snapshot/disposition, added controls, and the RTP + actions
 * + Annex A junction (design doc §2.8 rows 1–7).
 *
 * `ISRA_TREATMENT_OPTION` is given verbatim in the doc. `ISRA_RTP_STATUS`,
 * `ISRA_TREATMENT_STATUS` and `ISRA_RTP_ACTION_STATUS` were previously
 * inferred and have since been replaced with the OD baseline's own values
 * (js/core.js:13559, :15152, :15409). `ISRA_TREATMENT_APPROVAL_STATUS`/
 * `ISRA_REC_DISPOSITION` remain inferred (flagged in the F-1-impl report) —
 * all are STRING columns validated at the service layer, not DB constraints.
 */
export const ISRA_TREATMENT_OPTION = ["Avoid", "Modify", "Share", "Retain"] as const;
export type IsraTreatmentOption = (typeof ISRA_TREATMENT_OPTION)[number];

/** OD derives it on save in `isra2TreatForm` —
 * `status:opt==='Retain'?'Accepted':'Planning'`
 * (js/core.js:15152); 'Planning' and 'Accepted' are the only two values the
 * baseline ever stores (seeds at js/core.js:16631/16643/16684 agree). The
 * previous inferred list (Draft/Active/Superseded) appears nowhere in OD. */
export const ISRA_TREATMENT_STATUS = ["Planning", "Accepted"] as const;
export type IsraTreatmentStatus = (typeof ISRA_TREATMENT_STATUS)[number];

export const ISRA_TREATMENT_APPROVAL_STATUS = ["Pending", "Approved", "Rejected"] as const;
export type IsraTreatmentApprovalStatus = (typeof ISRA_TREATMENT_APPROVAL_STATUS)[number];

export const ISRA_REC_DISPOSITION = ["Already implemented", "Selected for implementation", "Not selected", "Not feasible"] as const;
export type IsraRecDisposition = (typeof ISRA_REC_DISPOSITION)[number];

/** OD `ISRA_RTP_STATUS` (js/core.js:13559) — copied verbatim. OD's own RTP
 * form select offers a narrower, partly different list ('Completed'/'On Hold'
 * instead of the six lifecycle states; js/core.js:15236) — the named constant
 * is taken as normative. */
export const ISRA_RTP_STATUS = [
  "Draft",
  "Planned",
  "Approved",
  "In Progress",
  "Implemented",
  "Pending Effectiveness Review",
  "Residual Review Due",
  "Closed",
  "Cancelled",
  "Overdue",
] as const;
export type IsraRtpStatus = (typeof ISRA_RTP_STATUS)[number];

/** OD `ISRA4_ACT_STATUS` (js/core.js:15409) copied verbatim, plus 'Planned' —
 * the value OD's Manage Action Plan modal offers and every OD seed writes
 * (`isra2ApmStatusOpts`, js/core.js:15265), and this port's column default. */
export const ISRA_RTP_ACTION_STATUS = [
  "Not started",
  "In progress",
  "Implemented",
  "Submitted for verification",
  "Verified",
  "Rejected",
  "Needs rework",
  "Cancelled",
  "Planned",
] as const;
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
  /** `snapshotVersion` — which recommendation-snapshot version this commitment
   * was taken from (js/core.js:15165). */
  declare snapshotVersion: number | null;
  declare relatedVulnIds: CreationOptional<string[]>;
  declare relatedVulnNames: CreationOptional<string[]>;
  declare rationale: string | null;
  /** `intendedEffect` — 'likelihood' | 'both' in OD (js/core.js:15166, :15190). */
  declare intendedEffect: string | null;
  /** `targetEffectiveness` — an `ISRA_EFF_LEVELS` label, e.g. 'Strong'
   * (js/core.js:15166; levels at js/core.js:13566). */
  declare targetEffectiveness: string | null;
  declare owner: string | null;
  /** `status` — OD only ever writes 'Committed' on selection (js/core.js:15166). */
  declare status: CreationOptional<string>;
  declare selectionDate: Date | null;
  declare source: string | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
IsraScenarioAddedControl.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    scenarioId: { type: DataTypes.UUID, allowNull: false, field: "scenario_id" },
    annexRef: { type: DataTypes.STRING, allowNull: false, field: "annex_ref" },
    snapshotVersion: { type: DataTypes.INTEGER, allowNull: true, field: "snapshot_version" },
    relatedVulnIds: { type: DataTypes.JSONB, allowNull: false, defaultValue: [], field: "related_vuln_ids" },
    relatedVulnNames: { type: DataTypes.JSONB, allowNull: false, defaultValue: [], field: "related_vuln_names" },
    rationale: { type: DataTypes.TEXT, allowNull: true },
    intendedEffect: { type: DataTypes.STRING, allowNull: true, field: "intended_effect" },
    targetEffectiveness: { type: DataTypes.STRING, allowNull: true, field: "target_effectiveness" },
    owner: { type: DataTypes.STRING, allowNull: true },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Committed" },
    selectionDate: { type: DataTypes.DATE, allowNull: true, field: "selection_date" },
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
  /** The treatment cycle this plan belongs to — `cycle:isra2TreatCycle(sc)`
   * (js/core.js:15246). */
  declare cycle: CreationOptional<number>;
  /** The treatment option the plan implements; OD copies it off the decision
   * (`option:opt`, js/core.js:15246) and refuses a plan for 'Retain'. */
  declare option: string | null;
  declare title: string | null;
  declare description: string | null;
  /** `addedControlIds[]` — the Added Annex A controls ticked into scope on the
   * plan (js/core.js:15246). Kept as a JSONB id array, matching OD; the
   * per-action Annex A refs stay in `IsraRtpActionControl`. */
  declare addedControlIds: CreationOptional<string[]>;
  declare owner: string | null;
  declare supporting: string | null;
  declare resources: string | null;
  declare startDate: string | null;
  declare targetDate: string | null;
  declare expectedEvidence: string | null;
  declare dependencies: string | null;
  declare version: CreationOptional<number>;
  declare status: CreationOptional<string>;
  declare createdBy: string | null;
  declare approvedBy: string | null;
  declare approvedAt: Date | null;
  declare funding: CreationOptional<IsraFundingLine[]>;
  declare monitoring: string | null;
  declare completionCriteria: string | null;
  /** Set when the treatment option changes underneath the plan
   * (`if(sc.rtp)sc.rtp.needsReview=true`, js/core.js:15150). */
  declare needsReview: CreationOptional<boolean>;
  declare isCurrent: CreationOptional<boolean>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
IsraRtp.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    scenarioId: { type: DataTypes.UUID, allowNull: false, field: "scenario_id" },
    cycle: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    option: { type: DataTypes.STRING, allowNull: true },
    title: { type: DataTypes.STRING, allowNull: true },
    description: { type: DataTypes.TEXT, allowNull: true },
    addedControlIds: { type: DataTypes.JSONB, allowNull: false, defaultValue: [], field: "added_control_ids" },
    owner: { type: DataTypes.STRING, allowNull: true },
    supporting: { type: DataTypes.STRING, allowNull: true },
    resources: { type: DataTypes.STRING, allowNull: true },
    startDate: { type: DataTypes.DATEONLY, allowNull: true, field: "start_date" },
    targetDate: { type: DataTypes.DATEONLY, allowNull: true, field: "target_date" },
    expectedEvidence: { type: DataTypes.TEXT, allowNull: true, field: "expected_evidence" },
    dependencies: { type: DataTypes.STRING, allowNull: true },
    version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Draft" },
    createdBy: { type: DataTypes.STRING, allowNull: true, field: "created_by" },
    approvedBy: { type: DataTypes.STRING, allowNull: true, field: "approved_by" },
    approvedAt: { type: DataTypes.DATE, allowNull: true, field: "approved_at" },
    funding: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    monitoring: { type: DataTypes.TEXT, allowNull: true },
    completionCriteria: { type: DataTypes.TEXT, allowNull: true, field: "completion_criteria" },
    needsReview: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: "needs_review" },
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
  declare relatedVulnIds: CreationOptional<string[]>;
  declare relatedVulnNames: CreationOptional<string[]>;
  declare targetDate: string | null;
  /** `evidenceRequired` — the evidence the step must produce, as OD stores it
   * (a single string; js/core.js:15291). The `evidence` array below is this
   * port's own collected-evidence list, not an OD field. */
  declare evidenceRequired: string | null;
  declare completionCriteria: string | null;
  declare status: CreationOptional<string>;
  /** Provenance when the step was copied out of a treatment template —
   * `isra2RtpCopyTemplates` (js/core.js:15291); the library template itself
   * is left untouched. */
  declare templateId: string | null;
  declare templateVer: number | null;
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
    relatedVulnIds: { type: DataTypes.JSONB, allowNull: false, defaultValue: [], field: "related_vuln_ids" },
    relatedVulnNames: { type: DataTypes.JSONB, allowNull: false, defaultValue: [], field: "related_vuln_names" },
    targetDate: { type: DataTypes.DATEONLY, allowNull: true, field: "target_date" },
    evidenceRequired: { type: DataTypes.TEXT, allowNull: true, field: "evidence_required" },
    completionCriteria: { type: DataTypes.TEXT, allowNull: true, field: "completion_criteria" },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Planned" },
    templateId: { type: DataTypes.STRING, allowNull: true, field: "template_id" },
    templateVer: { type: DataTypes.INTEGER, allowNull: true, field: "template_ver" },
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
