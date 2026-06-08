import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * Phase 7 (Business Units) — the `business_records` table backs every module of
 * the operating company's internal areas: Enterprise (ERP / System of Record),
 * Datana (cybersecurity), and Motoran (rental). They share one structure: an
 * org-scoped record (owned by the Service Owner org) keyed by `area` + `module`,
 * with a `code`, `title`, `status`, optional `owner`, and a module-specific `data`
 * JSONB payload. Statuses/types live in the frontend register config (STRING).
 */
export const up: Migration = async ({ context: q }) => {
  await q.createTable("business_records", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "organizations", key: "id" },
      onDelete: "CASCADE",
    },
    area: { type: DataTypes.STRING, allowNull: false },
    module: { type: DataTypes.STRING, allowNull: false },
    code: { type: DataTypes.STRING, allowNull: false },
    title: { type: DataTypes.STRING, allowNull: false },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Open" },
    owner: { type: DataTypes.STRING, allowNull: true },
    data: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
  await q.addIndex("business_records", ["area", "module"]);
};

export const down: Migration = async ({ context: q }) => {
  await q.dropTable("business_records");
};
