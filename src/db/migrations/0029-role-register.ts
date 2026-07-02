import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * Tenant organizational role register (ISO 5.3): role templates (responsibilities
 * & authorities catalog) and their assignments to team members, with a first-class
 * "modified" state when an assignment diverges from its template.
 */
export const up: Migration = async ({ context: q }) => {
  await q.createTable("role_templates", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: { type: DataTypes.UUID, allowNull: false, references: { model: "organizations", key: "id" }, onDelete: "CASCADE" },
    code: { type: DataTypes.STRING, allowNull: false },
    name: { type: DataTypes.STRING, allowNull: false },
    category: { type: DataTypes.STRING, allowNull: false, defaultValue: "Other" },
    purpose: { type: DataTypes.TEXT, allowNull: true },
    work_units: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    processes: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    frameworks: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    responsibilities: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    authorities: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Draft" },
    notes: { type: DataTypes.TEXT, allowNull: true },
    created_by: { type: DataTypes.STRING, allowNull: true },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
  await q.addIndex("role_templates", ["org_id"]);

  await q.createTable("role_assignments", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: { type: DataTypes.UUID, allowNull: false, references: { model: "organizations", key: "id" }, onDelete: "CASCADE" },
    code: { type: DataTypes.STRING, allowNull: false },
    member_id: { type: DataTypes.STRING, allowNull: false },
    member_name: { type: DataTypes.STRING, allowNull: false },
    role_id: { type: DataTypes.UUID, allowNull: false, references: { model: "role_templates", key: "id" }, onDelete: "CASCADE" },
    role_name: { type: DataTypes.STRING, allowNull: false },
    work_unit: { type: DataTypes.STRING, allowNull: true },
    effective_date: { type: DataTypes.STRING, allowNull: true },
    responsibilities: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    authorities: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    modified: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    mod_reason: { type: DataTypes.TEXT, allowNull: true },
    mod_summary: { type: DataTypes.TEXT, allowNull: true },
    modified_by: { type: DataTypes.STRING, allowNull: true },
    modified_date: { type: DataTypes.STRING, allowNull: true },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Active" },
    notes: { type: DataTypes.TEXT, allowNull: true },
    created_by: { type: DataTypes.STRING, allowNull: true },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
  await q.addIndex("role_assignments", ["org_id"]);
  await q.addIndex("role_assignments", ["role_id"]);
};

export const down: Migration = async ({ context: q }) => {
  await q.dropTable("role_assignments");
  await q.dropTable("role_templates");
};
