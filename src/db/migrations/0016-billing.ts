import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * Phase 3 (Commercial) — Billing foundation. Adds the `plans` catalog and the
 * `invoices` table (the billing source of truth; payments, receipts and partner
 * revenue-share are derived from invoices). Also links existing subscriptions to
 * a plan via a nullable `plan_id` (additive — old rows stay valid). New tables, so
 * the status ENUMs are created directly.
 */
export const up: Migration = async ({ context: q }) => {
  await q.createTable("plans", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    code: { type: DataTypes.STRING, allowNull: false, unique: true },
    name: { type: DataTypes.STRING, allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: true },
    billing_frequency: { type: DataTypes.ENUM("Monthly", "Annual"), allowNull: false, defaultValue: "Monthly" },
    status: { type: DataTypes.ENUM("Draft", "Active", "Inactive"), allowNull: false, defaultValue: "Active" },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });

  await q.createTable("invoices", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    number: { type: DataTypes.STRING, allowNull: false, unique: true },
    org_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "organizations", key: "id" },
      onDelete: "CASCADE",
    },
    period: { type: DataTypes.STRING, allowNull: false },
    start: { type: DataTypes.DATEONLY, allowNull: false },
    end: { type: DataTypes.DATEONLY, allowNull: false },
    amount: { type: DataTypes.INTEGER, allowNull: false },
    currency: { type: DataTypes.STRING, allowNull: false, defaultValue: "IDR" },
    status: { type: DataTypes.ENUM("Paid", "Unpaid", "Draft"), allowNull: false, defaultValue: "Draft" },
    paid_date: { type: DataTypes.DATEONLY, allowNull: true },
    due_date: { type: DataTypes.DATEONLY, allowNull: true },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
  await q.addIndex("invoices", ["org_id"]);

  await q.addColumn("subscriptions", "plan_id", {
    type: DataTypes.UUID,
    allowNull: true,
    references: { model: "plans", key: "id" },
    onDelete: "SET NULL",
  });
};

export const down: Migration = async ({ context: q }) => {
  await q.removeColumn("subscriptions", "plan_id");
  await q.dropTable("invoices");
  await q.dropTable("plans");
};
