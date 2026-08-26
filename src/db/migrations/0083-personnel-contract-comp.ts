import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * Personnel record subsystem, chunk 3/3 (OD `ent-personnel`, SOF-48-5):
 * contract-document editor, activity timeline, onboarding checklist, and
 * compensation/bank binding (`parity/frontend.md:1176-1188`). All four key
 * off `users.id` directly rather than `personnel_profiles` (chunk 1,
 * SOF-48-1) — none of this data depends on the personal/emergency/employment
 * sub-record existing.
 */
export const up: Migration = async ({ context: q }) => {
  await q.createTable("personnel_contract_documents", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: { type: DataTypes.UUID, allowNull: false, references: { model: "organizations", key: "id" }, onDelete: "CASCADE" },
    user_id: { type: DataTypes.UUID, allowNull: false, references: { model: "users", key: "id" }, onDelete: "CASCADE" },
    title: { type: DataTypes.STRING, allowNull: false },
    doc_type: { type: DataTypes.STRING, allowNull: true },
    status: { type: DataTypes.ENUM("Draft", "Final", "Signed", "Expired"), allowNull: false, defaultValue: "Draft" },
    version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    content: { type: DataTypes.TEXT, allowNull: true },
    effective_date: { type: DataTypes.DATEONLY, allowNull: true },
    expiry_date: { type: DataTypes.DATEONLY, allowNull: true },
    signed_by: { type: DataTypes.STRING, allowNull: true },
    signed_at: { type: DataTypes.DATE, allowNull: true },
    created_by: { type: DataTypes.STRING, allowNull: true },
    last_updated_by: { type: DataTypes.STRING, allowNull: true },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
  await q.addIndex("personnel_contract_documents", ["org_id"]);
  await q.addIndex("personnel_contract_documents", ["user_id"]);

  await q.createTable("personnel_activity_log", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: { type: DataTypes.UUID, allowNull: false, references: { model: "organizations", key: "id" }, onDelete: "CASCADE" },
    user_id: { type: DataTypes.UUID, allowNull: false, references: { model: "users", key: "id" }, onDelete: "CASCADE" },
    actor: { type: DataTypes.STRING, allowNull: true },
    action: { type: DataTypes.STRING, allowNull: false },
    detail: { type: DataTypes.TEXT, allowNull: true },
    meta: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
  await q.addIndex("personnel_activity_log", ["org_id"]);
  await q.addIndex("personnel_activity_log", ["user_id"]);

  await q.createTable("personnel_onboarding_items", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: { type: DataTypes.UUID, allowNull: false, references: { model: "organizations", key: "id" }, onDelete: "CASCADE" },
    user_id: { type: DataTypes.UUID, allowNull: false, references: { model: "users", key: "id" }, onDelete: "CASCADE" },
    label: { type: DataTypes.STRING, allowNull: false },
    seq: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    done: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    done_at: { type: DataTypes.DATE, allowNull: true },
    done_by: { type: DataTypes.STRING, allowNull: true },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
  await q.addIndex("personnel_onboarding_items", ["org_id"]);
  await q.addIndex("personnel_onboarding_items", ["user_id"]);

  await q.createTable("personnel_compensation", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: { type: DataTypes.UUID, allowNull: false, references: { model: "organizations", key: "id" }, onDelete: "CASCADE" },
    user_id: { type: DataTypes.UUID, allowNull: false, unique: true, references: { model: "users", key: "id" }, onDelete: "CASCADE" },
    comp_record_id: { type: DataTypes.UUID, allowNull: true, references: { model: "business_records", key: "id" }, onDelete: "SET NULL" },
    bank_name: { type: DataTypes.STRING, allowNull: true },
    bank_account_no: { type: DataTypes.STRING, allowNull: true },
    bank_account_name: { type: DataTypes.STRING, allowNull: true },
    tax_id: { type: DataTypes.STRING, allowNull: true },
    tax_status: { type: DataTypes.STRING, allowNull: true },
    effective_date: { type: DataTypes.DATEONLY, allowNull: true },
    minwage_record_id: { type: DataTypes.UUID, allowNull: true, references: { model: "business_records", key: "id" }, onDelete: "SET NULL" },
    minwage_compliant: { type: DataTypes.BOOLEAN, allowNull: true },
    created_by: { type: DataTypes.STRING, allowNull: true },
    last_updated_by: { type: DataTypes.STRING, allowNull: true },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
  await q.addIndex("personnel_compensation", ["org_id"]);
};

export const down: Migration = async ({ context: q }) => {
  await q.dropTable("personnel_compensation");
  await q.dropTable("personnel_onboarding_items");
  await q.dropTable("personnel_activity_log");
  await q.dropTable("personnel_contract_documents");
};
