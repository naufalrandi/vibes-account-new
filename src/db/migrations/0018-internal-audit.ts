import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * Internal Audit (ISO 9.2). Program → Plan → Session → Finding hierarchy plus
 * Report snapshots and a per-org Settings singleton. Statuses/types are STRING
 * (validated in the service against the canonical arrays); array fields and the
 * activity/comment envelope are JSONB.
 */
const ENVELOPE = {
  created_by: { type: DataTypes.STRING, allowNull: true },
  last_updated_by: { type: DataTypes.STRING, allowNull: true },
  activity: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
  comments: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
  created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
};

export const up: Migration = async ({ context: q }) => {
  await q.createTable("ia_programs", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: { type: DataTypes.UUID, allowNull: false, references: { model: "organizations", key: "id" }, onDelete: "CASCADE" },
    code: { type: DataTypes.STRING, allowNull: false, unique: true },
    name: { type: DataTypes.STRING, allowNull: false },
    period: { type: DataTypes.STRING, allowNull: false },
    processes: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    work_units: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    methods: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    criteria: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    scope: { type: DataTypes.TEXT, allowNull: true },
    objective: { type: DataTypes.TEXT, allowNull: true },
    lead_auditor: { type: DataTypes.STRING, allowNull: false },
    auditors: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    independence: { type: DataTypes.STRING, allowNull: false, defaultValue: "Checked" },
    override_just: { type: DataTypes.TEXT, allowNull: true },
    duration: { type: DataTypes.STRING, allowNull: true },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Draft" },
    notes: { type: DataTypes.TEXT, allowNull: true },
    ...ENVELOPE,
  });
  await q.addIndex("ia_programs", ["org_id"]);

  await q.createTable("ia_plans", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: { type: DataTypes.UUID, allowNull: false, references: { model: "organizations", key: "id" }, onDelete: "CASCADE" },
    code: { type: DataTypes.STRING, allowNull: false, unique: true },
    program_id: { type: DataTypes.UUID, allowNull: false, references: { model: "ia_programs", key: "id" }, onDelete: "CASCADE" },
    name: { type: DataTypes.STRING, allowNull: false },
    processes: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    criteria: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    lead_auditor: { type: DataTypes.STRING, allowNull: true },
    auditors: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    notes: { type: DataTypes.TEXT, allowNull: true },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Draft" },
    ...ENVELOPE,
  });
  await q.addIndex("ia_plans", ["org_id"]);
  await q.addIndex("ia_plans", ["program_id"]);

  await q.createTable("ia_sessions", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: { type: DataTypes.UUID, allowNull: false, references: { model: "organizations", key: "id" }, onDelete: "CASCADE" },
    code: { type: DataTypes.STRING, allowNull: false, unique: true },
    plan_id: { type: DataTypes.UUID, allowNull: false, references: { model: "ia_plans", key: "id" }, onDelete: "CASCADE" },
    program_id: { type: DataTypes.UUID, allowNull: false, references: { model: "ia_programs", key: "id" }, onDelete: "CASCADE" },
    title: { type: DataTypes.STRING, allowNull: false },
    date: { type: DataTypes.DATEONLY, allowNull: false },
    start: { type: DataTypes.STRING, allowNull: false },
    end: { type: DataTypes.STRING, allowNull: false },
    tz: { type: DataTypes.STRING, allowNull: false, defaultValue: "Asia/Jakarta" },
    auditor: { type: DataTypes.STRING, allowNull: false },
    auditee: { type: DataTypes.STRING, allowNull: true },
    criteria: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    process: { type: DataTypes.STRING, allowNull: false },
    work_unit: { type: DataTypes.STRING, allowNull: true },
    methods: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    location: { type: DataTypes.STRING, allowNull: true },
    link: { type: DataTypes.STRING, allowNull: true },
    notes: { type: DataTypes.TEXT, allowNull: true },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Scheduled" },
    ...ENVELOPE,
  });
  await q.addIndex("ia_sessions", ["org_id"]);
  await q.addIndex("ia_sessions", ["plan_id"]);
  await q.addIndex("ia_sessions", ["program_id"]);

  await q.createTable("ia_findings", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: { type: DataTypes.UUID, allowNull: false, references: { model: "organizations", key: "id" }, onDelete: "CASCADE" },
    code: { type: DataTypes.STRING, allowNull: false, unique: true },
    program_id: { type: DataTypes.UUID, allowNull: false, references: { model: "ia_programs", key: "id" }, onDelete: "CASCADE" },
    plan_id: { type: DataTypes.UUID, allowNull: true, references: { model: "ia_plans", key: "id" }, onDelete: "SET NULL" },
    session_id: { type: DataTypes.UUID, allowNull: true, references: { model: "ia_sessions", key: "id" }, onDelete: "SET NULL" },
    title: { type: DataTypes.STRING, allowNull: false },
    type: { type: DataTypes.STRING, allowNull: false, defaultValue: "Nonconformity" },
    description: { type: DataTypes.TEXT, allowNull: false },
    evidence: { type: DataTypes.TEXT, allowNull: true },
    frameworks: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    criteria: { type: DataTypes.STRING, allowNull: true },
    process: { type: DataTypes.STRING, allowNull: false },
    work_unit: { type: DataTypes.STRING, allowNull: true },
    site: { type: DataTypes.STRING, allowNull: false, defaultValue: "" },
    auditor: { type: DataTypes.STRING, allowNull: true },
    pic: { type: DataTypes.STRING, allowNull: true },
    due: { type: DataTypes.DATEONLY, allowNull: true },
    review_required: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    review_status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Not Required" },
    review_decision: { type: DataTypes.STRING, allowNull: true },
    review_notes: { type: DataTypes.TEXT, allowNull: true },
    issue_status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Draft" },
    issued_to: { type: DataTypes.STRING, allowNull: true },
    issued_date: { type: DataTypes.STRING, allowNull: true },
    linked_nc: { type: DataTypes.STRING, allowNull: true },
    linked_imp: { type: DataTypes.STRING, allowNull: true },
    ...ENVELOPE,
  });
  await q.addIndex("ia_findings", ["org_id"]);
  await q.addIndex("ia_findings", ["program_id"]);
  await q.addIndex("ia_findings", ["session_id"]);

  await q.createTable("ia_reports", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: { type: DataTypes.UUID, allowNull: false, references: { model: "organizations", key: "id" }, onDelete: "CASCADE" },
    code: { type: DataTypes.STRING, allowNull: false, unique: true },
    program_id: { type: DataTypes.UUID, allowNull: false, references: { model: "ia_programs", key: "id" }, onDelete: "CASCADE" },
    period: { type: DataTypes.STRING, allowNull: false },
    plans: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    sessions: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    findings: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    evidence_summary: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    followup_included: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    summary: { type: DataTypes.TEXT, allowNull: true },
    conclusion: { type: DataTypes.TEXT, allowNull: true },
    prepared_by: { type: DataTypes.STRING, allowNull: true },
    approved_by: { type: DataTypes.STRING, allowNull: true },
    report_date: { type: DataTypes.STRING, allowNull: true },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Generated" },
    ...ENVELOPE,
  });
  await q.addIndex("ia_reports", ["org_id"]);
  await q.addIndex("ia_reports", ["program_id"]);

  await q.createTable("ia_settings", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: { type: DataTypes.UUID, allowNull: false, unique: true, references: { model: "organizations", key: "id" }, onDelete: "CASCADE" },
    mandatory_review: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    allow_issue_no_review: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    allow_admin_nc: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    require_evidence: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    require_pic: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    require_due: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    allow_override: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
};

export const down: Migration = async ({ context: q }) => {
  await q.dropTable("ia_settings");
  await q.dropTable("ia_reports");
  await q.dropTable("ia_findings");
  await q.dropTable("ia_sessions");
  await q.dropTable("ia_plans");
  await q.dropTable("ia_programs");
};
