import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { sequelize } from "../sequelize";

/** A bell notification: per-user (`userId`) or org-wide (`userId` NULL). */
export class Notification extends Model<InferAttributes<Notification>, InferCreationAttributes<Notification>> {
  declare id: CreationOptional<string>;
  declare orgId: string | null;
  declare userId: string | null;
  declare type: CreationOptional<string>;
  declare text: string;
  declare link: string | null;
  declare read: CreationOptional<boolean>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

Notification.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: true, field: "org_id" },
    userId: { type: DataTypes.UUID, allowNull: true, field: "user_id" },
    type: { type: DataTypes.STRING, allowNull: false, defaultValue: "info" },
    text: { type: DataTypes.STRING, allowNull: false },
    link: { type: DataTypes.STRING, allowNull: true },
    read: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "notifications", underscored: true },
);
