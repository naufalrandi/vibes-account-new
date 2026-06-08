import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * Phase 5 (Tenant Implementation suite) — the `implementation_records` table backs
 * the 8 tenant ISO-management registers (documents, compliance, risks, competence,
 * objectives, audits, reviews, incidents). They share one structure: an org-scoped
 * record with a business `code` (per module/tenant), `title`, `status`, optional
 * `owner`, and a module-specific `data` JSONB payload. `module` selects the
 * register; statuses/types live in the module config (STRING, mutable labels).
 */
export const up: Migration = async ({ context: q }) => {
  await q.createTable("implementation_records", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "organizations", key: "id" },
      onDelete: "CASCADE",
    },
    module: { type: DataTypes.STRING, allowNull: false },
    code: { type: DataTypes.STRING, allowNull: false },
    title: { type: DataTypes.STRING, allowNull: false },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Open" },
    owner: { type: DataTypes.STRING, allowNull: true },
    data: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
  await q.addIndex("implementation_records", ["org_id", "module"]);
};

export const down: Migration = async ({ context: q }) => {
  await q.dropTable("implementation_records");
};
