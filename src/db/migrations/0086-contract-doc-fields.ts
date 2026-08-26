import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * SOF-58 follow-up: closes the `contractDocs` gap in
 * `parity/backend-unseeded.md` (OD `personContractDocCard`/`cdDraftContract`,
 * `modules.js:5251`). `personnel_contract_documents` (migration 0083) already
 * covers the generic "contract document editor" shape (title/status/version/
 * signedBy/signedAt); it is extended here rather than replaced with a new
 * table, since the only fields OD's employment-contract vertical adds on top
 * are the contract-type/template linkage, jurisdiction and the structured
 * clause snapshot array. `typeId`/`templateId` point at `business_records`
 * rows (`ent-ctypes`/`ent-ctype-templates`, SOF-25) the same way
 * `personnel_compensation.comp_record_id` already does.
 */
export const up: Migration = async ({ context: q }) => {
  await q.sequelize.query(`ALTER TYPE "enum_personnel_contract_documents_status" ADD VALUE IF NOT EXISTS 'Issued'`);
  await q.addColumn("personnel_contract_documents", "type_id", {
    type: DataTypes.UUID, allowNull: true, references: { model: "business_records", key: "id" }, onDelete: "SET NULL",
  });
  await q.addColumn("personnel_contract_documents", "country", { type: DataTypes.STRING, allowNull: true });
  await q.addColumn("personnel_contract_documents", "template_id", {
    type: DataTypes.UUID, allowNull: true, references: { model: "business_records", key: "id" }, onDelete: "SET NULL",
  });
  await q.addColumn("personnel_contract_documents", "issued_date", { type: DataTypes.DATEONLY, allowNull: true });
  await q.addColumn("personnel_contract_documents", "clauses", { type: DataTypes.JSONB, allowNull: false, defaultValue: [] });
};

export const down: Migration = async ({ context: q }) => {
  await q.removeColumn("personnel_contract_documents", "clauses");
  await q.removeColumn("personnel_contract_documents", "issued_date");
  await q.removeColumn("personnel_contract_documents", "template_id");
  await q.removeColumn("personnel_contract_documents", "country");
  await q.removeColumn("personnel_contract_documents", "type_id");
  // Postgres cannot drop a single enum value in place; leaving 'Issued' is harmless.
};
