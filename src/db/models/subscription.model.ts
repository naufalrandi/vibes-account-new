import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { sequelize } from "../sequelize";

export class Subscription extends Model<InferAttributes<Subscription>, InferCreationAttributes<Subscription>> {
  declare id: CreationOptional<string>;
  declare orgId: string;
  declare plan: string;
  declare entitlements: Record<string, unknown>;
  declare status: string;
  declare startDate: Date;
  declare endDate: Date | null;
}

Subscription.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: false, field: "org_id" },
    plan: { type: DataTypes.STRING, allowNull: false },
    entitlements: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Active" },
    startDate: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: "start_date" },
    endDate: { type: DataTypes.DATE, allowNull: true, field: "end_date" },
  },
  { sequelize, tableName: "subscriptions", underscored: true, timestamps: false },
);
