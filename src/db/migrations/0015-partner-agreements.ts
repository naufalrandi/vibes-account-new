import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * Phase 3 (Commercial) — the `partner_agreements` table: per-partner agreement
 * instances generated from an agreement template. Snapshots the template version
 * + blocks (vars filled) so the partner copy is immutable until regenerated.
 * `number` (AGR-2026-####) is unique but nullable while Draft. New table, so the
 * 4-value status ENUM is created directly (no ALTER TYPE).
 */
export const up: Migration = async ({ context: q }) => {
  await q.createTable("partner_agreements", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "organizations", key: "id" },
      onDelete: "CASCADE",
    },
    agreement_template_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "agreement_templates", key: "id" },
      onDelete: "RESTRICT",
    },
    number: { type: DataTypes.STRING, allowNull: true, unique: true },
    version: { type: DataTypes.STRING, allowNull: false, defaultValue: "v1.0" },
    status: {
      type: DataTypes.ENUM("Draft", "Pending Approval", "Approved", "Terminated"),
      allowNull: false,
      defaultValue: "Draft",
    },
    effective_date: { type: DataTypes.DATEONLY, allowNull: true },
    expiration_date: { type: DataTypes.DATEONLY, allowNull: true },
    vars: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    rendered_blocks: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    history: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
  await q.addIndex("partner_agreements", ["org_id"]);
};

export const down: Migration = async ({ context: q }) => {
  await q.dropTable("partner_agreements");
};
