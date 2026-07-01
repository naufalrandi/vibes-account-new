import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { sequelize } from "../sequelize";

/**
 * Internal Audit (ISO 9.2) — a 5-entity hierarchy (Program → Plan → Session →
 * Finding, plus Report) with a per-org Settings singleton. Statuses/types are
 * stored as STRING and validated in the service against the canonical arrays
 * below (same approach as the clause-register engine), so no Postgres ENUM
 * churn. Array fields and the shared activity/comment envelope are JSONB.
 */

export const IA_PROG_STATUS = ["Draft", "Approved", "Planned", "In Progress", "Completed", "Report Generated", "Closed", "Cancelled", "Archived"] as const;
export const IA_PLAN_STATUS = ["Draft", "Scheduled", "In Progress", "Completed", "Cancelled", "Archived"] as const;
export const IA_SESS_STATUS = ["Scheduled", "In Progress", "Completed", "Cancelled", "Rescheduled"] as const;
export const IA_METHODS = ["Document review", "Interview", "Observation", "Sampling", "System walkthrough", "Evidence review", "On-site audit", "Remote audit", "Hybrid audit"] as const;
export const IA_FIND_TYPES = ["Nonconformity", "Observation", "Opportunity for Improvement", "Positive Finding", "Conformity"] as const;
export const IA_REVIEW_STATUS = ["Not Required", "Pending Lead Auditor Review", "Approved", "Revision Requested", "Rejected"] as const;
export const IA_ISSUE_STATUS = ["Draft", "Pending Lead Auditor Review", "Revision Requested", "Rejected", "Ready to Issue", "Issued", "Accepted by PIC", "Follow-up Created", "Closed"] as const;
export const IA_REPORT_STATUS = ["Draft", "Generated", "Under Review", "Approved", "Issued", "Archived"] as const;
export const IA_REVIEW_DECISIONS = ["Approve Finding", "Request Revision", "Reject Finding"] as const;

export type IaProgStatus = (typeof IA_PROG_STATUS)[number];
export type IaPlanStatus = (typeof IA_PLAN_STATUS)[number];
export type IaSessStatus = (typeof IA_SESS_STATUS)[number];
export type IaFindType = (typeof IA_FIND_TYPES)[number];
export type IaReviewStatus = (typeof IA_REVIEW_STATUS)[number];
export type IaIssueStatus = (typeof IA_ISSUE_STATUS)[number];
export type IaReportStatus = (typeof IA_REPORT_STATUS)[number];

/** Shared audit-trail envelope carried by every IA entity. */
export interface IaActivityEntry { ts: string; user: string; action: string; summary?: string }
export interface IaComment { ts: string; user: string; text: string }

export class IaProgram extends Model<InferAttributes<IaProgram>, InferCreationAttributes<IaProgram>> {
  declare id: CreationOptional<string>;
  declare orgId: string;
  declare code: string;
  declare name: string;
  declare period: string;
  declare processes: CreationOptional<string[]>;
  declare workUnits: CreationOptional<string[]>;
  declare methods: CreationOptional<string[]>;
  declare criteria: CreationOptional<string[]>;
  declare scope: string | null;
  declare objective: string | null;
  declare leadAuditor: string;
  declare auditors: CreationOptional<string[]>;
  declare independence: CreationOptional<string>;
  declare overrideJust: string | null;
  declare duration: string | null;
  declare status: CreationOptional<string>;
  declare notes: string | null;
  declare createdBy: string | null;
  declare lastUpdatedBy: string | null;
  declare activity: CreationOptional<IaActivityEntry[]>;
  declare comments: CreationOptional<IaComment[]>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
IaProgram.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: false, field: "org_id" },
    code: { type: DataTypes.STRING, allowNull: false, unique: true },
    name: { type: DataTypes.STRING, allowNull: false },
    period: { type: DataTypes.STRING, allowNull: false },
    processes: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    workUnits: { type: DataTypes.JSONB, allowNull: false, defaultValue: [], field: "work_units" },
    methods: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    criteria: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    scope: { type: DataTypes.TEXT, allowNull: true },
    objective: { type: DataTypes.TEXT, allowNull: true },
    leadAuditor: { type: DataTypes.STRING, allowNull: false, field: "lead_auditor" },
    auditors: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    independence: { type: DataTypes.STRING, allowNull: false, defaultValue: "Checked" },
    overrideJust: { type: DataTypes.TEXT, allowNull: true, field: "override_just" },
    duration: { type: DataTypes.STRING, allowNull: true },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Draft" },
    notes: { type: DataTypes.TEXT, allowNull: true },
    createdBy: { type: DataTypes.STRING, allowNull: true, field: "created_by" },
    lastUpdatedBy: { type: DataTypes.STRING, allowNull: true, field: "last_updated_by" },
    activity: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    comments: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "ia_programs", underscored: true },
);

export class IaPlan extends Model<InferAttributes<IaPlan>, InferCreationAttributes<IaPlan>> {
  declare id: CreationOptional<string>;
  declare orgId: string;
  declare code: string;
  declare programId: string;
  declare name: string;
  declare processes: CreationOptional<string[]>;
  declare criteria: CreationOptional<string[]>;
  declare leadAuditor: string | null;
  declare auditors: CreationOptional<string[]>;
  declare notes: string | null;
  declare status: CreationOptional<string>;
  declare createdBy: string | null;
  declare lastUpdatedBy: string | null;
  declare activity: CreationOptional<IaActivityEntry[]>;
  declare comments: CreationOptional<IaComment[]>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
IaPlan.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: false, field: "org_id" },
    code: { type: DataTypes.STRING, allowNull: false, unique: true },
    programId: { type: DataTypes.UUID, allowNull: false, field: "program_id" },
    name: { type: DataTypes.STRING, allowNull: false },
    processes: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    criteria: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    leadAuditor: { type: DataTypes.STRING, allowNull: true, field: "lead_auditor" },
    auditors: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    notes: { type: DataTypes.TEXT, allowNull: true },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Draft" },
    createdBy: { type: DataTypes.STRING, allowNull: true, field: "created_by" },
    lastUpdatedBy: { type: DataTypes.STRING, allowNull: true, field: "last_updated_by" },
    activity: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    comments: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "ia_plans", underscored: true },
);

export class IaSession extends Model<InferAttributes<IaSession>, InferCreationAttributes<IaSession>> {
  declare id: CreationOptional<string>;
  declare orgId: string;
  declare code: string;
  declare planId: string;
  declare programId: string;
  declare title: string;
  declare date: string;
  declare start: string;
  declare end: string;
  declare tz: CreationOptional<string>;
  declare auditor: string;
  declare auditee: string | null;
  declare criteria: CreationOptional<string[]>;
  declare process: string;
  declare workUnit: string | null;
  declare methods: CreationOptional<string[]>;
  declare location: string | null;
  declare link: string | null;
  declare notes: string | null;
  declare status: CreationOptional<string>;
  declare createdBy: string | null;
  declare lastUpdatedBy: string | null;
  declare activity: CreationOptional<IaActivityEntry[]>;
  declare comments: CreationOptional<IaComment[]>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
IaSession.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: false, field: "org_id" },
    code: { type: DataTypes.STRING, allowNull: false, unique: true },
    planId: { type: DataTypes.UUID, allowNull: false, field: "plan_id" },
    programId: { type: DataTypes.UUID, allowNull: false, field: "program_id" },
    title: { type: DataTypes.STRING, allowNull: false },
    date: { type: DataTypes.DATEONLY, allowNull: false },
    start: { type: DataTypes.STRING, allowNull: false },
    end: { type: DataTypes.STRING, allowNull: false },
    tz: { type: DataTypes.STRING, allowNull: false, defaultValue: "Asia/Jakarta" },
    auditor: { type: DataTypes.STRING, allowNull: false },
    auditee: { type: DataTypes.STRING, allowNull: true },
    criteria: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    process: { type: DataTypes.STRING, allowNull: false },
    workUnit: { type: DataTypes.STRING, allowNull: true, field: "work_unit" },
    methods: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    location: { type: DataTypes.STRING, allowNull: true },
    link: { type: DataTypes.STRING, allowNull: true },
    notes: { type: DataTypes.TEXT, allowNull: true },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Scheduled" },
    createdBy: { type: DataTypes.STRING, allowNull: true, field: "created_by" },
    lastUpdatedBy: { type: DataTypes.STRING, allowNull: true, field: "last_updated_by" },
    activity: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    comments: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "ia_sessions", underscored: true },
);

export class IaFinding extends Model<InferAttributes<IaFinding>, InferCreationAttributes<IaFinding>> {
  declare id: CreationOptional<string>;
  declare orgId: string;
  declare code: string;
  declare programId: string;
  declare planId: string | null;
  declare sessionId: string | null;
  declare title: string;
  declare type: CreationOptional<string>;
  declare description: string;
  declare evidence: string | null;
  declare frameworks: CreationOptional<string[]>;
  declare criteria: string | null;
  declare process: string;
  declare workUnit: string | null;
  declare site: CreationOptional<string>;
  declare auditor: string | null;
  declare pic: string | null;
  declare due: string | null;
  declare reviewRequired: CreationOptional<boolean>;
  declare reviewStatus: CreationOptional<string>;
  declare reviewDecision: string | null;
  declare reviewNotes: string | null;
  declare issueStatus: CreationOptional<string>;
  declare issuedTo: string | null;
  declare issuedDate: string | null;
  declare linkedNC: string | null;
  declare linkedImp: string | null;
  declare createdBy: string | null;
  declare lastUpdatedBy: string | null;
  declare activity: CreationOptional<IaActivityEntry[]>;
  declare comments: CreationOptional<IaComment[]>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
IaFinding.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: false, field: "org_id" },
    code: { type: DataTypes.STRING, allowNull: false, unique: true },
    programId: { type: DataTypes.UUID, allowNull: false, field: "program_id" },
    planId: { type: DataTypes.UUID, allowNull: true, field: "plan_id" },
    sessionId: { type: DataTypes.UUID, allowNull: true, field: "session_id" },
    title: { type: DataTypes.STRING, allowNull: false },
    type: { type: DataTypes.STRING, allowNull: false, defaultValue: "Nonconformity" },
    description: { type: DataTypes.TEXT, allowNull: false },
    evidence: { type: DataTypes.TEXT, allowNull: true },
    frameworks: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    criteria: { type: DataTypes.STRING, allowNull: true },
    process: { type: DataTypes.STRING, allowNull: false },
    workUnit: { type: DataTypes.STRING, allowNull: true, field: "work_unit" },
    site: { type: DataTypes.STRING, allowNull: false, defaultValue: "" },
    auditor: { type: DataTypes.STRING, allowNull: true },
    pic: { type: DataTypes.STRING, allowNull: true },
    due: { type: DataTypes.DATEONLY, allowNull: true },
    reviewRequired: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: "review_required" },
    reviewStatus: { type: DataTypes.STRING, allowNull: false, defaultValue: "Not Required", field: "review_status" },
    reviewDecision: { type: DataTypes.STRING, allowNull: true, field: "review_decision" },
    reviewNotes: { type: DataTypes.TEXT, allowNull: true, field: "review_notes" },
    issueStatus: { type: DataTypes.STRING, allowNull: false, defaultValue: "Draft", field: "issue_status" },
    issuedTo: { type: DataTypes.STRING, allowNull: true, field: "issued_to" },
    issuedDate: { type: DataTypes.STRING, allowNull: true, field: "issued_date" },
    linkedNC: { type: DataTypes.STRING, allowNull: true, field: "linked_nc" },
    linkedImp: { type: DataTypes.STRING, allowNull: true, field: "linked_imp" },
    createdBy: { type: DataTypes.STRING, allowNull: true, field: "created_by" },
    lastUpdatedBy: { type: DataTypes.STRING, allowNull: true, field: "last_updated_by" },
    activity: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    comments: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "ia_findings", underscored: true },
);

export class IaReport extends Model<InferAttributes<IaReport>, InferCreationAttributes<IaReport>> {
  declare id: CreationOptional<string>;
  declare orgId: string;
  declare code: string;
  declare programId: string;
  declare period: string;
  declare plans: CreationOptional<string[]>;
  declare sessions: CreationOptional<string[]>;
  declare findings: CreationOptional<string[]>;
  declare evidenceSummary: CreationOptional<boolean>;
  declare followupIncluded: CreationOptional<boolean>;
  declare summary: string | null;
  declare conclusion: string | null;
  declare preparedBy: string | null;
  declare approvedBy: string | null;
  declare reportDate: string | null;
  declare status: CreationOptional<string>;
  declare createdBy: string | null;
  declare lastUpdatedBy: string | null;
  declare activity: CreationOptional<IaActivityEntry[]>;
  declare comments: CreationOptional<IaComment[]>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
IaReport.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: false, field: "org_id" },
    code: { type: DataTypes.STRING, allowNull: false, unique: true },
    programId: { type: DataTypes.UUID, allowNull: false, field: "program_id" },
    period: { type: DataTypes.STRING, allowNull: false },
    plans: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    sessions: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    findings: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    evidenceSummary: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: "evidence_summary" },
    followupIncluded: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: "followup_included" },
    summary: { type: DataTypes.TEXT, allowNull: true },
    conclusion: { type: DataTypes.TEXT, allowNull: true },
    preparedBy: { type: DataTypes.STRING, allowNull: true, field: "prepared_by" },
    approvedBy: { type: DataTypes.STRING, allowNull: true, field: "approved_by" },
    reportDate: { type: DataTypes.STRING, allowNull: true, field: "report_date" },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Generated" },
    createdBy: { type: DataTypes.STRING, allowNull: true, field: "created_by" },
    lastUpdatedBy: { type: DataTypes.STRING, allowNull: true, field: "last_updated_by" },
    activity: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    comments: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "ia_reports", underscored: true },
);

export class IaSettings extends Model<InferAttributes<IaSettings>, InferCreationAttributes<IaSettings>> {
  declare id: CreationOptional<string>;
  declare orgId: string;
  declare mandatoryReview: CreationOptional<boolean>;
  declare allowIssueNoReview: CreationOptional<boolean>;
  declare allowAdminNC: CreationOptional<boolean>;
  declare requireEvidence: CreationOptional<boolean>;
  declare requirePIC: CreationOptional<boolean>;
  declare requireDue: CreationOptional<boolean>;
  declare allowOverride: CreationOptional<boolean>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
IaSettings.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: false, unique: true, field: "org_id" },
    mandatoryReview: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: "mandatory_review" },
    allowIssueNoReview: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: "allow_issue_no_review" },
    allowAdminNC: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: "allow_admin_nc" },
    requireEvidence: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: "require_evidence" },
    requirePIC: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: "require_pic" },
    requireDue: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: "require_due" },
    allowOverride: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: "allow_override" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "ia_settings", underscored: true },
);
