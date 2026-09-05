import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { sequelize } from "../sequelize";

/**
 * Evaluation area (ISO §9.1 Performance Evaluation, §9.3 Management Review).
 * Two independent, tenant-scoped entities:
 *
 * - `PerfEval` — an immutable-by-design snapshot record (period + indicator
 *   set + summary). Indicators are user-entered/pasted structured data here,
 *   NOT live-computed from the ~14 other modules the design mockup sources
 *   them from — that cross-module computation is out of scope.
 * - `MReview` — a scheduled meeting (ISO 9.3 management review) with a fixed
 *   catalog of standard input topics the org selects a subset of, each
 *   topic later recorded with inputs/outputs/decisions/actions.
 *
 * Same shape as internal-audit.models.ts: STRING status/enum columns
 * (validated in the service against the canonical arrays below, no Postgres
 * ENUM churn), JSONB for array/object fields.
 */

export const PEV_STATUS = ["Draft", "Final"] as const;

export interface PerfEvalIndicator {
  name: string;
  cat: string;
  src: string;
  unit: string;
  dir: string;
  target: string;
  val: string;
  status: string;
}

/**
 * An objective frozen into the evaluation snapshot alongside the indicators —
 * OD `perfRecord` (js/core.js:8042) takes `objTenantList().map(o => ({id,
 * title, owner, unit, dir, target, val, status, period}))` and stores it as
 * `objectives` on the `db.perfEvals` row next to `indicators`
 * (js/core.js:8043); `perfSeedBaseline` (js/core.js:7949-7950) writes the same
 * array minus `period`, so that one field is optional. Rendered as the
 * "Objectives at evaluation (§6.2)" table in the record drawer
 * (js/core.js:8031).
 */
export interface PerfEvalObjective {
  id: string;
  title: string;
  owner: string;
  unit: string;
  dir: string;
  target: string;
  val: string;
  status: string;
  period?: string;
}

export class PerfEval extends Model<InferAttributes<PerfEval>, InferCreationAttributes<PerfEval>> {
  declare id: CreationOptional<string>;
  declare orgId: string;
  declare code: string;
  declare period: string;
  declare date: string;
  declare owner: string;
  declare summary: string | null;
  declare indicators: CreationOptional<PerfEvalIndicator[]>;
  declare objectives: CreationOptional<PerfEvalObjective[]>;
  declare createdBy: string | null;
  declare lastUpdatedBy: string | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
PerfEval.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: false, field: "org_id" },
    code: { type: DataTypes.STRING, allowNull: false, unique: true },
    period: { type: DataTypes.STRING, allowNull: false },
    date: { type: DataTypes.DATEONLY, allowNull: false },
    owner: { type: DataTypes.STRING, allowNull: false },
    summary: { type: DataTypes.TEXT, allowNull: true },
    indicators: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    objectives: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    createdBy: { type: DataTypes.STRING, allowNull: true, field: "created_by" },
    lastUpdatedBy: { type: DataTypes.STRING, allowNull: true, field: "last_updated_by" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "perf_evals", underscored: true },
);

// --- Management Review (ISO 9.3) -----------------------------------------

export const MR_FORMATS = ["Virtual", "On-site", "Hybrid"] as const;
export const MR_STATUS = ["Draft", "Scheduled", "In Progress", "Pending Outputs", "Completed", "Finalized", "Cancelled", "Archived"] as const;
export const MR_INVITE_REQ = ["Required", "Optional"] as const;
export const MR_INVITE_ATT = ["Pending", "Accepted", "Declined", "Attended"] as const;
export const MR_OUTPUT_CATEGORY = [
  "Decision", "Action Item", "Resource Need", "Policy Change", "Objective Change", "Process Change",
  "Risk Treatment", "Compliance Action", "Corrective Action", "Improvement Opportunity",
  "Communication Required", "No Action Required",
] as const;
export const MR_DECISION_STATUS = ["No Action Required", "Action Required", "In Progress", "Completed", "Deferred", "Escalated"] as const;
export const MR_ITEM_STATUS = ["Not Started", "Pending Review", "Reviewed", "Decision Recorded", "Action Required", "Completed", "Deferred"] as const;
export const MR_ACTION_PRIORITY = ["Low", "Medium", "High", "Critical"] as const;

/** OD's fixed catalog of standard ISO 9.3 management-review input topics. */
export const MR_TOPIC_CATALOG = [
  "Status of actions from previous management reviews",
  "Changes in external and internal issues",
  "Changes in needs and expectations of interested parties",
  "Scope suitability",
  "Policy suitability",
  "Objective achievement",
  "Process performance",
  "Customer satisfaction and feedback",
  "Nonconformities and corrective actions",
  "Monitoring and measurement results",
  "Internal audit results",
  "External audit results",
  "Compliance obligations fulfilment",
  "Risk and opportunity status",
  "Resource adequacy",
  "Competence, awareness, and training status",
  "Supplier and external provider performance",
  "Communication and consultation results",
  "Incident trends",
  "Security event trends",
  "Environmental performance",
  "OH&S performance",
  "Privacy performance",
  "Opportunities for improvement",
  "Changes affecting the management system",
] as const;

export interface MrInvitee { name: string; req: string; att: string }
export interface MrExternal { name: string }
export interface MrAction {
  title: string;
  desc: string;
  owner: string;
  due: string | null;
  priority: string;
  status: string;
}
export interface MrTopic {
  id: string;
  title: string;
  desc: string;
  frameworks: string[];
  inputSummary: string;
  output: string;
  outputCategory: string;
  decisionStatus: string;
  itemStatus: string;
  action: MrAction | null;
  responsible: string;
  due: string | null;
}

export class MReview extends Model<InferAttributes<MReview>, InferCreationAttributes<MReview>> {
  declare id: CreationOptional<string>;
  declare orgId: string;
  declare code: string;
  declare title: string | null;
  declare frameworks: CreationOptional<string[]>;
  declare date: string;
  declare time: string;
  declare tz: CreationOptional<string>;
  declare format: CreationOptional<string>;
  declare link: string | null;
  declare location: string | null;
  declare chairperson: string | null;
  declare recorder: string | null;
  declare status: CreationOptional<string>;
  declare invited: CreationOptional<MrInvitee[]>;
  declare external: CreationOptional<MrExternal[]>;
  declare agenda: string | null;
  declare prep: string | null;
  declare materials: string | null;
  declare topics: CreationOptional<MrTopic[]>;
  declare minutesSummary: string | null;
  declare finalizedBy: string | null;
  declare finalizedDate: string | null;
  declare version: CreationOptional<number>;
  declare createdBy: string | null;
  declare lastUpdatedBy: string | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
MReview.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: false, field: "org_id" },
    code: { type: DataTypes.STRING, allowNull: false, unique: true },
    title: { type: DataTypes.STRING, allowNull: true },
    frameworks: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    date: { type: DataTypes.DATEONLY, allowNull: false },
    time: { type: DataTypes.STRING, allowNull: false },
    tz: { type: DataTypes.STRING, allowNull: false, defaultValue: "Asia/Jakarta" },
    format: { type: DataTypes.STRING, allowNull: false, defaultValue: "Virtual" },
    link: { type: DataTypes.STRING, allowNull: true },
    location: { type: DataTypes.STRING, allowNull: true },
    chairperson: { type: DataTypes.STRING, allowNull: true },
    recorder: { type: DataTypes.STRING, allowNull: true },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Draft" },
    invited: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    external: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    agenda: { type: DataTypes.TEXT, allowNull: true },
    prep: { type: DataTypes.TEXT, allowNull: true },
    materials: { type: DataTypes.TEXT, allowNull: true },
    topics: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    minutesSummary: { type: DataTypes.TEXT, allowNull: true, field: "minutes_summary" },
    finalizedBy: { type: DataTypes.STRING, allowNull: true, field: "finalized_by" },
    finalizedDate: { type: DataTypes.STRING, allowNull: true, field: "finalized_date" },
    version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    createdBy: { type: DataTypes.STRING, allowNull: true, field: "created_by" },
    lastUpdatedBy: { type: DataTypes.STRING, allowNull: true, field: "last_updated_by" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "management_reviews", underscored: true },
);
