import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { sequelize } from "../sequelize";

export type BillingFrequency = "Monthly" | "Annual";
export type PlanStatus = "Draft" | "Active" | "Inactive";
export type InvoiceStatus = "Draft" | "Unpaid" | "Paid";
export type RevenueShareStatus = "Draft" | "Pending" | "Approved" | "Paid";
export type PayoutStatus = "Pending" | "Paid";

export class Plan extends Model<InferAttributes<Plan>, InferCreationAttributes<Plan>> {
  declare id: CreationOptional<string>;
  declare code: string;
  declare name: string;
  declare description: string | null;
  /** OD `seedPlans` js/core.js:21595 / `planModal` js/core.js:21758 call this `frequency`. */
  declare frequency: CreationOptional<BillingFrequency>;
  declare status: CreationOptional<PlanStatus>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
Plan.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    code: { type: DataTypes.STRING, allowNull: false, unique: true },
    name: { type: DataTypes.STRING, allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: true },
    frequency: { type: DataTypes.ENUM("Monthly", "Annual"), allowNull: false, defaultValue: "Monthly" },
    status: { type: DataTypes.ENUM("Draft", "Active", "Inactive"), allowNull: false, defaultValue: "Draft" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "plans", underscored: true },
);

export class Invoice extends Model<InferAttributes<Invoice>, InferCreationAttributes<Invoice>> {
  declare id: CreationOptional<string>;
  declare number: string;
  declare orgId: string;
  declare period: string;
  declare periodStart: string | null;
  declare periodEnd: string | null;
  declare amount: number;
  declare currency: CreationOptional<string>;
  declare status: CreationOptional<InvoiceStatus>;
  declare paidDate: string | null;
  declare dueDate: string | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
Invoice.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    number: { type: DataTypes.STRING, allowNull: false, unique: true },
    orgId: { type: DataTypes.UUID, allowNull: false, field: "org_id" },
    period: { type: DataTypes.STRING, allowNull: false },
    periodStart: { type: DataTypes.DATEONLY, allowNull: true, field: "period_start" },
    periodEnd: { type: DataTypes.DATEONLY, allowNull: true, field: "period_end" },
    amount: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
    currency: { type: DataTypes.STRING, allowNull: false, defaultValue: "IDR" },
    status: { type: DataTypes.ENUM("Draft", "Unpaid", "Paid"), allowNull: false, defaultValue: "Draft" },
    paidDate: { type: DataTypes.DATEONLY, allowNull: true, field: "paid_date" },
    dueDate: { type: DataTypes.DATEONLY, allowNull: true, field: "due_date" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "invoices", underscored: true },
);

export class Payment extends Model<InferAttributes<Payment>, InferCreationAttributes<Payment>> {
  declare id: CreationOptional<string>;
  declare code: string;
  declare invoiceId: string;
  declare orgId: string;
  declare date: string;
  declare amount: number;
  declare method: string;
  declare ref: string | null;
  declare status: CreationOptional<string>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
Payment.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    code: { type: DataTypes.STRING, allowNull: false, unique: true },
    invoiceId: { type: DataTypes.UUID, allowNull: false, field: "invoice_id" },
    orgId: { type: DataTypes.UUID, allowNull: false, field: "org_id" },
    date: { type: DataTypes.DATEONLY, allowNull: false },
    amount: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
    method: { type: DataTypes.STRING, allowNull: false },
    ref: { type: DataTypes.STRING, allowNull: true },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Verified" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "payments", underscored: true },
);

export class Receipt extends Model<InferAttributes<Receipt>, InferCreationAttributes<Receipt>> {
  declare id: CreationOptional<string>;
  declare code: string;
  declare invoiceId: string;
  declare paymentId: string;
  declare orgId: string;
  declare date: string;
  declare amount: number;
  declare status: CreationOptional<string>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
Receipt.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    code: { type: DataTypes.STRING, allowNull: false, unique: true },
    invoiceId: { type: DataTypes.UUID, allowNull: false, field: "invoice_id" },
    paymentId: { type: DataTypes.UUID, allowNull: false, field: "payment_id" },
    orgId: { type: DataTypes.UUID, allowNull: false, field: "org_id" },
    date: { type: DataTypes.DATEONLY, allowNull: false },
    amount: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Issued" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "receipts", underscored: true },
);

export class RevenueShareStatement extends Model<
  InferAttributes<RevenueShareStatement>,
  InferCreationAttributes<RevenueShareStatement>
> {
  declare id: CreationOptional<string>;
  declare code: string;
  declare partnerOrgId: string;
  declare period: string;
  declare totalRev: number;
  declare pct: number;
  declare partnerShare: number;
  declare axiaShare: number;
  declare status: CreationOptional<RevenueShareStatus>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
RevenueShareStatement.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    code: { type: DataTypes.STRING, allowNull: false, unique: true },
    partnerOrgId: { type: DataTypes.UUID, allowNull: false, field: "partner_org_id" },
    period: { type: DataTypes.STRING, allowNull: false },
    totalRev: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0, field: "total_rev" },
    pct: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    partnerShare: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0, field: "partner_share" },
    axiaShare: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0, field: "axia_share" },
    status: { type: DataTypes.ENUM("Draft", "Pending", "Approved", "Paid"), allowNull: false, defaultValue: "Draft" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "revenue_share_statements", underscored: true },
);

export class Payout extends Model<InferAttributes<Payout>, InferCreationAttributes<Payout>> {
  declare id: CreationOptional<string>;
  declare code: string;
  declare partnerOrgId: string;
  declare statementId: string | null;
  declare period: string;
  declare amount: number;
  declare date: string | null;
  declare status: CreationOptional<PayoutStatus>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
Payout.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    code: { type: DataTypes.STRING, allowNull: false, unique: true },
    partnerOrgId: { type: DataTypes.UUID, allowNull: false, field: "partner_org_id" },
    statementId: { type: DataTypes.UUID, allowNull: true, field: "statement_id" },
    period: { type: DataTypes.STRING, allowNull: false },
    amount: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
    date: { type: DataTypes.STRING, allowNull: true },
    status: { type: DataTypes.ENUM("Pending", "Paid"), allowNull: false, defaultValue: "Pending" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "payouts", underscored: true },
);
