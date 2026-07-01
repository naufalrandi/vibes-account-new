import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * Phase 6 — Support Tickets with SLA. A single `tickets` table; the threaded
 * messages, activity timeline, and attachment metadata live as JSONB arrays on
 * the ticket (mirroring the legacy `db.tickets` shape and the frontend contract).
 * SLA metrics (target/first-response/resolution/status) are NOT stored — they are
 * derived on read from the message + activity timestamps.
 *
 * Status/priority/category/scope enums use the spaced PRD labels the frontend
 * renders directly.
 */
export const up: Migration = async ({ context: q }) => {
  await q.createTable("tickets", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    code: { type: DataTypes.STRING, allowNull: false, unique: true },
    subject: { type: DataTypes.STRING, allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: false },
    category: {
      type: DataTypes.ENUM(
        "Technical Support", "Billing", "Commercial",
        "Feature Request", "Bug Report", "General Inquiry",
      ),
      allowNull: false,
      defaultValue: "Technical Support",
    },
    priority: { type: DataTypes.ENUM("Low", "Medium", "High", "Critical"), allowNull: false, defaultValue: "Medium" },
    status: {
      type: DataTypes.ENUM("Open", "In Progress", "Waiting for Customer", "Resolved", "Closed"),
      allowNull: false,
      defaultValue: "Open",
    },
    scope: { type: DataTypes.ENUM("sp", "partner", "tenant"), allowNull: false },
    org_id: { type: DataTypes.UUID, allowNull: false, references: { model: "organizations", key: "id" }, onDelete: "CASCADE" },
    managed_by: { type: DataTypes.STRING, allowNull: true },
    created_by: { type: DataTypes.JSONB, allowNull: false },
    assigned_to: { type: DataTypes.STRING, allowNull: true },
    messages: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    activity: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    attachments: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
  await q.addIndex("tickets", ["org_id"]);
};

export const down: Migration = async ({ context: q }) => {
  await q.dropTable("tickets");
};
