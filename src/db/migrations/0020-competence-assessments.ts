import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * Competence roles-as-profiles, personnel assignments, competence assessments
 * (with computed score/status/valid-until), and development gaps. Nested role
 * profile structures (responsibilities/authorities with linked competences,
 * experience requirements) and assessment requirement checklists are JSONB.
 */
export const up: Migration = async ({ context: q }) => {
  await q.createTable("competence_roles", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: { type: DataTypes.UUID, allowNull: true, references: { model: "organizations", key: "id" }, onDelete: "CASCADE" },
    name: { type: DataTypes.STRING, allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: true },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Draft" },
    review_freq: { type: DataTypes.STRING, allowNull: false, defaultValue: "12" },
    edu_min_level_id: { type: DataTypes.UUID, allowNull: true, references: { model: "competence_education", key: "id" }, onDelete: "SET NULL" },
    edu_fields: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    edu_country: { type: DataTypes.STRING, allowNull: true },
    exp_reqs: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    responsibilities: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    authorities: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
  await q.addIndex("competence_roles", ["org_id"]);

  await q.createTable("competence_assignments", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: { type: DataTypes.UUID, allowNull: false, references: { model: "organizations", key: "id" }, onDelete: "CASCADE" },
    person_id: { type: DataTypes.UUID, allowNull: false },
    person_name: { type: DataTypes.STRING, allowNull: true },
    role_id: { type: DataTypes.UUID, allowNull: false, references: { model: "competence_roles", key: "id" }, onDelete: "CASCADE" },
    assigned_date: { type: DataTypes.DATEONLY, allowNull: true },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Active" },
    latest_assessment_id: { type: DataTypes.UUID, allowNull: true },
    latest_status: { type: DataTypes.STRING, allowNull: true },
    latest_date: { type: DataTypes.DATEONLY, allowNull: true },
    valid_until: { type: DataTypes.DATEONLY, allowNull: true },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
  await q.addIndex("competence_assignments", ["org_id"]);
  await q.addIndex("competence_assignments", ["role_id"]);

  await q.createTable("competence_assessments", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: { type: DataTypes.UUID, allowNull: false, references: { model: "organizations", key: "id" }, onDelete: "CASCADE" },
    code: { type: DataTypes.STRING, allowNull: false, unique: true },
    assignment_id: { type: DataTypes.UUID, allowNull: false, references: { model: "competence_assignments", key: "id" }, onDelete: "CASCADE" },
    person_id: { type: DataTypes.UUID, allowNull: false },
    role_id: { type: DataTypes.UUID, allowNull: false, references: { model: "competence_roles", key: "id" }, onDelete: "CASCADE" },
    assessor: { type: DataTypes.STRING, allowNull: true },
    date: { type: DataTypes.DATEONLY, allowNull: true },
    notes: { type: DataTypes.TEXT, allowNull: true },
    requirements: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    score: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    open_gaps: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Not yet competent" },
    valid_until: { type: DataTypes.DATEONLY, allowNull: true },
    approval_state: { type: DataTypes.STRING, allowNull: false, defaultValue: "Pending" },
    approved_by: { type: DataTypes.STRING, allowNull: true },
    approved_date: { type: DataTypes.DATEONLY, allowNull: true },
    activity: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    comments: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
  await q.addIndex("competence_assessments", ["org_id"]);
  await q.addIndex("competence_assessments", ["assignment_id"]);

  await q.createTable("competence_gaps", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: { type: DataTypes.UUID, allowNull: false, references: { model: "organizations", key: "id" }, onDelete: "CASCADE" },
    code: { type: DataTypes.STRING, allowNull: false, unique: true },
    assessment_id: { type: DataTypes.UUID, allowNull: true, references: { model: "competence_assessments", key: "id" }, onDelete: "SET NULL" },
    assignment_id: { type: DataTypes.UUID, allowNull: false, references: { model: "competence_assignments", key: "id" }, onDelete: "CASCADE" },
    person_id: { type: DataTypes.UUID, allowNull: false },
    role_id: { type: DataTypes.UUID, allowNull: false, references: { model: "competence_roles", key: "id" }, onDelete: "CASCADE" },
    req_key: { type: DataTypes.STRING, allowNull: false },
    req_label: { type: DataTypes.STRING, allowNull: true },
    kind: { type: DataTypes.STRING, allowNull: true },
    eval_type: { type: DataTypes.STRING, allowNull: true },
    current_level: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    required_level: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    severity: { type: DataTypes.STRING, allowNull: false },
    action: { type: DataTypes.TEXT, allowNull: true },
    owner: { type: DataTypes.STRING, allowNull: true },
    due: { type: DataTypes.DATEONLY, allowNull: true },
    training: { type: DataTypes.STRING, allowNull: true },
    training_done: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    training_date: { type: DataTypes.DATEONLY, allowNull: true },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Open" },
    resolved_date: { type: DataTypes.DATEONLY, allowNull: true },
    resolved_by: { type: DataTypes.STRING, allowNull: true },
    created_date: { type: DataTypes.DATEONLY, allowNull: true },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
  await q.addIndex("competence_gaps", ["org_id"]);
  await q.addIndex("competence_gaps", ["assignment_id"]);
};

export const down: Migration = async ({ context: q }) => {
  await q.dropTable("competence_gaps");
  await q.dropTable("competence_assessments");
  await q.dropTable("competence_assignments");
  await q.dropTable("competence_roles");
};
