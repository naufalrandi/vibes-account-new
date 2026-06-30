import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * Phase 3 — Partners (Distributor commercial model) + Partnership Agreements.
 *
 * Per decision R2 a Partner is a `Distributor` organization plus a 1:1
 * `partner_profiles` extension holding the commercial detail (code, tier,
 * lifecycle status, denormalized audit trail). Per decision R8 agreement
 * templates are stored as structured JSON blocks (not rendered HTML); per-partner
 * `partner_agreements` hold the filled variable values + a rendered snapshot.
 *
 * Lifecycle enums use the spaced PRD labels the frontend renders directly
 * (no normalization layer needed).
 */
export const up: Migration = async ({ context: q }) => {
  await q.createTable("partner_profiles", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: {
      type: DataTypes.UUID,
      allowNull: false,
      unique: true,
      references: { model: "organizations", key: "id" },
      onDelete: "CASCADE",
    },
    code: { type: DataTypes.STRING, allowNull: false, unique: true },
    tier: { type: DataTypes.ENUM("Bronze", "Silver", "Gold"), allowNull: true },
    status: {
      type: DataTypes.ENUM("Draft", "Pending Approval", "Approved", "Active", "Suspended", "Terminated"),
      allowNull: false,
      defaultValue: "Draft",
    },
    admin_user_id: { type: DataTypes.UUID, allowNull: true },
    commercial_summary: { type: DataTypes.JSONB, allowNull: true },
    audit: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });

  await q.createTable("agreement_templates", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "organizations", key: "id" },
      onDelete: "CASCADE",
    },
    code: { type: DataTypes.STRING, allowNull: false, unique: true },
    name: { type: DataTypes.STRING, allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: true },
    version: { type: DataTypes.STRING, allowNull: false, defaultValue: "v1.0" },
    status: {
      type: DataTypes.ENUM("Draft", "Active", "Archived"),
      allowNull: false,
      defaultValue: "Draft",
    },
    blocks: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
  await q.addIndex("agreement_templates", ["org_id"]);

  await q.createTable("partner_agreements", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: {
      type: DataTypes.UUID,
      allowNull: false,
      unique: true,
      references: { model: "organizations", key: "id" },
      onDelete: "CASCADE",
    },
    template_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: "agreement_templates", key: "id" },
      onDelete: "SET NULL",
    },
    template_name: { type: DataTypes.STRING, allowNull: false },
    number: { type: DataTypes.STRING, allowNull: true },
    version: { type: DataTypes.STRING, allowNull: false, defaultValue: "v1.0" },
    status: {
      type: DataTypes.ENUM("Draft", "Pending Approval", "Approved", "Terminated"),
      allowNull: false,
      defaultValue: "Pending Approval",
    },
    effective_date: { type: DataTypes.DATEONLY, allowNull: true },
    expiration_date: { type: DataTypes.DATEONLY, allowNull: true },
    vars: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    rendered_blocks: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    history: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
};

export const down: Migration = async ({ context: q }) => {
  await q.dropTable("partner_agreements");
  await q.dropTable("agreement_templates");
  await q.dropTable("partner_profiles");
};
