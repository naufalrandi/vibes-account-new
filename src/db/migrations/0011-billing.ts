import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * Phase 5 — Billing. Plans, invoices, payments, receipts, partner revenue-share
 * statements, and payouts.
 *
 * Money is stored as BIGINT whole currency units (IDR has no minor unit; the
 * frontend renders plain numbers like 12,000,000). BIGINT + Number() on read
 * avoids float drift while staying within JS safe-integer range. Invoice/site/etc
 * status enums use the spaced PRD labels the frontend renders directly.
 */
export const up: Migration = async ({ context: q }) => {
  await q.createTable("plans", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    code: { type: DataTypes.STRING, allowNull: false, unique: true },
    name: { type: DataTypes.STRING, allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: true },
    billing_frequency: { type: DataTypes.ENUM("Monthly", "Annual"), allowNull: false, defaultValue: "Monthly" },
    status: { type: DataTypes.ENUM("Draft", "Active", "Inactive"), allowNull: false, defaultValue: "Draft" },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });

  await q.createTable("invoices", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    number: { type: DataTypes.STRING, allowNull: false, unique: true },
    org_id: { type: DataTypes.UUID, allowNull: false, references: { model: "organizations", key: "id" }, onDelete: "CASCADE" },
    period: { type: DataTypes.STRING, allowNull: false },
    period_start: { type: DataTypes.DATEONLY, allowNull: true },
    period_end: { type: DataTypes.DATEONLY, allowNull: true },
    amount: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
    currency: { type: DataTypes.STRING, allowNull: false, defaultValue: "IDR" },
    status: { type: DataTypes.ENUM("Draft", "Unpaid", "Paid"), allowNull: false, defaultValue: "Draft" },
    paid_date: { type: DataTypes.DATEONLY, allowNull: true },
    due_date: { type: DataTypes.DATEONLY, allowNull: true },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
  await q.addIndex("invoices", ["org_id"]);

  await q.createTable("payments", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    code: { type: DataTypes.STRING, allowNull: false, unique: true },
    invoice_id: { type: DataTypes.UUID, allowNull: false, references: { model: "invoices", key: "id" }, onDelete: "CASCADE" },
    org_id: { type: DataTypes.UUID, allowNull: false, references: { model: "organizations", key: "id" }, onDelete: "CASCADE" },
    date: { type: DataTypes.DATEONLY, allowNull: false },
    amount: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
    method: { type: DataTypes.STRING, allowNull: false },
    ref: { type: DataTypes.STRING, allowNull: true },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Verified" },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
  await q.addIndex("payments", ["org_id"]);

  await q.createTable("receipts", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    code: { type: DataTypes.STRING, allowNull: false, unique: true },
    invoice_id: { type: DataTypes.UUID, allowNull: false, references: { model: "invoices", key: "id" }, onDelete: "CASCADE" },
    payment_id: { type: DataTypes.UUID, allowNull: false, references: { model: "payments", key: "id" }, onDelete: "CASCADE" },
    org_id: { type: DataTypes.UUID, allowNull: false, references: { model: "organizations", key: "id" }, onDelete: "CASCADE" },
    date: { type: DataTypes.DATEONLY, allowNull: false },
    amount: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Issued" },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
  await q.addIndex("receipts", ["org_id"]);

  await q.createTable("revenue_share_statements", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    code: { type: DataTypes.STRING, allowNull: false, unique: true },
    partner_org_id: { type: DataTypes.UUID, allowNull: false, references: { model: "organizations", key: "id" }, onDelete: "CASCADE" },
    period: { type: DataTypes.STRING, allowNull: false },
    total_rev: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
    pct: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    partner_share: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
    axia_share: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
    status: { type: DataTypes.ENUM("Draft", "Pending", "Approved", "Paid"), allowNull: false, defaultValue: "Draft" },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
  await q.addIndex("revenue_share_statements", ["partner_org_id"]);

  await q.createTable("payouts", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    code: { type: DataTypes.STRING, allowNull: false, unique: true },
    partner_org_id: { type: DataTypes.UUID, allowNull: false, references: { model: "organizations", key: "id" }, onDelete: "CASCADE" },
    statement_id: { type: DataTypes.UUID, allowNull: true, references: { model: "revenue_share_statements", key: "id" }, onDelete: "SET NULL" },
    period: { type: DataTypes.STRING, allowNull: false },
    amount: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
    date: { type: DataTypes.STRING, allowNull: true },
    status: { type: DataTypes.ENUM("Pending", "Paid"), allowNull: false, defaultValue: "Pending" },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
  await q.addIndex("payouts", ["partner_org_id"]);
};

export const down: Migration = async ({ context: q }) => {
  await q.dropTable("payouts");
  await q.dropTable("revenue_share_statements");
  await q.dropTable("receipts");
  await q.dropTable("payments");
  await q.dropTable("invoices");
  await q.dropTable("plans");
};
