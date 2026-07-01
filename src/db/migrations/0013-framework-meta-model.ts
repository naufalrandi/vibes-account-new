import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * Phase 7 — Framework meta-model (the cross-framework harmonization engine, the
 * product's core IP). Adds the assessable layer on top of the existing framework
 * catalog: reusable Framework Elements (FWE), per-framework Requirements (FWR),
 * maturity Criteria (FWRC), Conformance Questions/Responses (CQ/CQR), the
 * Element↔Requirement cross-reference (xref), and the Response→Criterion map
 * (rcmap, stored as a 1:1 column on responses).
 *
 * The existing `frameworks` catalog table is EXTENDED (not replaced) so the
 * frontend's group-based Framework Library and the catalog tree share one table
 * (framework_assignments + organization_frameworks already FK it). `group_id`
 * and `jurisdictions` are additive; `family_id`/`code` become nullable so a
 * group-based framework needs neither; the status enum gains "Active".
 */
export const up: Migration = async ({ context: q }) => {
  // Framework groups (Standards / Regulations) for the meta-model Library.
  await q.createTable("framework_groups", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    name: { type: DataTypes.STRING, allowNull: false, unique: true },
    sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });

  // Extend the catalog frameworks table for the meta-model.
  await q.addColumn("frameworks", "group_id", {
    type: DataTypes.UUID, allowNull: true,
    references: { model: "framework_groups", key: "id" }, onDelete: "SET NULL",
  });
  await q.addColumn("frameworks", "jurisdictions", { type: DataTypes.JSONB, allowNull: false, defaultValue: [] });
  await q.sequelize.query('ALTER TABLE "frameworks" ALTER COLUMN "family_id" DROP NOT NULL');
  await q.sequelize.query('ALTER TABLE "frameworks" ALTER COLUMN "code" DROP NOT NULL');
  // The frontend uses Draft/Active/Archived; the catalog used Draft/Published/Archived.
  await q.sequelize.query(`ALTER TYPE "enum_frameworks_status" ADD VALUE IF NOT EXISTS 'Active'`);

  await q.createTable("framework_elements", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    code: { type: DataTypes.STRING, allowNull: false, unique: true },
    name: { type: DataTypes.STRING, allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: true },
    category: { type: DataTypes.ENUM("Core", "Framework Extension"), allowNull: false, defaultValue: "Core" },
    status: { type: DataTypes.ENUM("Draft", "Active", "Archived"), allowNull: false, defaultValue: "Active" },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });

  await q.createTable("framework_requirements", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    framework_id: { type: DataTypes.UUID, allowNull: false, references: { model: "frameworks", key: "id" }, onDelete: "CASCADE" },
    code: { type: DataTypes.STRING, allowNull: false },
    subject: { type: DataTypes.STRING, allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: false },
    status: { type: DataTypes.ENUM("Draft", "Active", "Archived"), allowNull: false, defaultValue: "Active" },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
  await q.addIndex("framework_requirements", ["framework_id"]);

  await q.createTable("requirement_criteria", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    requirement_id: { type: DataTypes.UUID, allowNull: false, references: { model: "framework_requirements", key: "id" }, onDelete: "CASCADE" },
    score: { type: DataTypes.INTEGER, allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: false },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
  await q.addIndex("requirement_criteria", ["requirement_id"]);

  // Element ↔ Requirement cross-reference (xref).
  await q.createTable("element_requirement_xref", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    element_id: { type: DataTypes.UUID, allowNull: false, references: { model: "framework_elements", key: "id" }, onDelete: "CASCADE" },
    requirement_id: { type: DataTypes.UUID, allowNull: false, references: { model: "framework_requirements", key: "id" }, onDelete: "CASCADE" },
  });
  await q.addIndex("element_requirement_xref", ["element_id"]);
  await q.addIndex("element_requirement_xref", ["requirement_id"]);
  await q.addConstraint("element_requirement_xref", { fields: ["element_id", "requirement_id"], type: "unique", name: "element_requirement_unique" });

  await q.createTable("conformance_questions", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    element_id: { type: DataTypes.UUID, allowNull: false, references: { model: "framework_elements", key: "id" }, onDelete: "CASCADE" },
    text: { type: DataTypes.TEXT, allowNull: false },
    sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    status: { type: DataTypes.ENUM("Draft", "Active"), allowNull: false, defaultValue: "Draft" },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
  await q.addIndex("conformance_questions", ["element_id"]);

  await q.createTable("conformance_responses", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    question_id: { type: DataTypes.UUID, allowNull: false, references: { model: "conformance_questions", key: "id" }, onDelete: "CASCADE" },
    text: { type: DataTypes.TEXT, allowNull: false },
    sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    status: { type: DataTypes.ENUM("Draft", "Active"), allowNull: false, defaultValue: "Draft" },
    // rcmap: the single criterion this response maps to (the scoring bridge).
    criterion_id: { type: DataTypes.UUID, allowNull: true, references: { model: "requirement_criteria", key: "id" }, onDelete: "SET NULL" },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
  await q.addIndex("conformance_responses", ["question_id"]);
};

export const down: Migration = async ({ context: q }) => {
  await q.dropTable("conformance_responses");
  await q.dropTable("conformance_questions");
  await q.dropTable("element_requirement_xref");
  await q.dropTable("requirement_criteria");
  await q.dropTable("framework_requirements");
  await q.dropTable("framework_elements");
  await q.removeColumn("frameworks", "jurisdictions");
  await q.removeColumn("frameworks", "group_id");
  await q.dropTable("framework_groups");
};
