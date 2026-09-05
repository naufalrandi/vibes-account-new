import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { sequelize } from "../sequelize";

export type BillingFrequency = "Monthly" | "Annual";
export type PlanStatus = "Draft" | "Active" | "Inactive";

/**
 * A subscription plan — the commercial offering available to tenants. Pricing is
 * configured later; a plan defines name, billing frequency and lifecycle status.
 * Platform-global master data managed only by the Service Owner.
 *
 * NOTE (baseline conformance, not fixed here): OD calls the field `frequency`,
 * not `billingFrequency` (`seedPlans`, js/core.js:21595; `planModal`,
 * js/core.js:21758, writing it at js/core.js:21770). Renaming it means a
 * column rename plus
 * src/db/models/billing.models.ts, src/modules/billing/{billing.service,
 * billing.controller}.ts, src/db/seeders/seed.ts and the billing integration
 * test — all outside this change. That same duplicate `Plan` in
 * billing.models.ts is the one actually registered in src/db/models/index.ts;
 * nothing imports this file. Note also that billing.service.ts:55 defaults a
 * new plan to "Active", overriding the "Draft" OD picks.
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
    // OD `planModal` pre-selects "Draft" for a new plan (js/core.js:21765);
    // `PLAN_STATUSES` is Draft/Active/Inactive (js/core.js:21584). The `plans`
    // table default is already "Draft" (migration 0011).
    status: { type: DataTypes.ENUM("Draft", "Active", "Inactive"), allowNull: false, defaultValue: "Draft" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "plans", underscored: true },
);
