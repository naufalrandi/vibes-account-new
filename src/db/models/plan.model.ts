import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { sequelize } from "../sequelize";

export type BillingFrequency = "Monthly" | "Annual";
export type PlanStatus = "Draft" | "Active" | "Inactive";

/**
 * A subscription plan — the commercial offering available to tenants. Pricing is
 * configured later; a plan defines name, billing frequency and lifecycle status.
 * Platform-global master data managed only by the Service Owner.
 */
export class Plan extends Model<InferAttributes<Plan>, InferCreationAttributes<Plan>> {
  declare id: CreationOptional<string>;
  declare code: string;
  declare name: string;
  declare description: string | null;
  declare billingFrequency: CreationOptional<BillingFrequency>;
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
    billingFrequency: { type: DataTypes.ENUM("Monthly", "Annual"), allowNull: false, defaultValue: "Monthly", field: "billing_frequency" },
    status: { type: DataTypes.ENUM("Draft", "Active", "Inactive"), allowNull: false, defaultValue: "Active" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "plans", underscored: true },
);
