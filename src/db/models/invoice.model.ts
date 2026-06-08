import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { sequelize } from "../sequelize";

export type InvoiceStatus = "Paid" | "Unpaid" | "Draft";

/**
 * A tenant invoice for a billing period. Source of truth for billing: payments,
 * receipts and partner revenue-share are derived from invoices. Amount is stored
 * as an integer minor-unit-free value (IDR has no decimals in the AXIA data).
 */
export class Invoice extends Model<InferAttributes<Invoice>, InferCreationAttributes<Invoice>> {
  declare id: CreationOptional<string>;
  declare number: string;
  declare orgId: string;
  declare period: string;
  declare start: string;
  declare end: string;
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
    start: { type: DataTypes.DATEONLY, allowNull: false },
    end: { type: DataTypes.DATEONLY, allowNull: false },
    amount: { type: DataTypes.INTEGER, allowNull: false },
    currency: { type: DataTypes.STRING, allowNull: false, defaultValue: "IDR" },
    status: { type: DataTypes.ENUM("Paid", "Unpaid", "Draft"), allowNull: false, defaultValue: "Draft" },
    paidDate: { type: DataTypes.DATEONLY, allowNull: true, field: "paid_date" },
    dueDate: { type: DataTypes.DATEONLY, allowNull: true, field: "due_date" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "invoices", underscored: true },
);
