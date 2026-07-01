import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * Phase 9 — ISO management-system clause registers (the tenant `tn-m-*` modules).
 *
 * One shared table backs every clause register (Organizational Context, Risk,
 * Policies, Internal Audit, Management Review, …). The `module` column is the
 * discriminator; per-module status enums, code prefixes and field shapes live in
 * `src/modules/implementation/registry.ts`. Module-specific data lives in the
 * `data` JSONB blob; `element_id` traces an entry to a Framework Element (FWE)
 * and `frameworks` records framework relevance.
 */
export const up: Migration = async ({ context: q }) => {
  await q.createTable("implementation_records", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: { type: DataTypes.UUID, allowNull: false, references: { model: "organizations", key: "id" }, onDelete: "CASCADE" },
    module: { type: DataTypes.STRING, allowNull: false },
    code: { type: DataTypes.STRING, allowNull: false },
    title: { type: DataTypes.STRING, allowNull: false },
    status: { type: DataTypes.STRING, allowNull: false },
    owner: { type: DataTypes.STRING, allowNull: true },
    data: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    element_id: { type: DataTypes.UUID, allowNull: true, references: { model: "framework_elements", key: "id" }, onDelete: "SET NULL" },
    frameworks: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
  await q.addIndex("implementation_records", ["org_id"]);
  await q.addIndex("implementation_records", ["module"]);
  await q.addConstraint("implementation_records", { fields: ["module", "code"], type: "unique", name: "implementation_module_code_unique" });
};

export const down: Migration = async ({ context: q }) => {
  await q.dropTable("implementation_records");
};
