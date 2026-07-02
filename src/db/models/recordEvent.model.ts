import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { sequelize } from "../sequelize";

/**
 * A per-record event — either an auto-generated activity entry or a user comment —
 * attached to any implementation/register record by (module, recordId). Backs the
 * OD prototype's shared record-detail Activity Timeline + Comments.
 */
export class RecordEvent extends Model<
  InferAttributes<RecordEvent>,
  InferCreationAttributes<RecordEvent>
> {
  declare id: CreationOptional<string>;
  declare orgId: string;
  declare module: string;
  declare recordId: string;
  declare type: "activity" | "comment";
  declare actor: string | null;
  declare text: string;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

RecordEvent.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: false, field: "org_id" },
    module: { type: DataTypes.STRING, allowNull: false },
    recordId: { type: DataTypes.STRING, allowNull: false, field: "record_id" },
    type: { type: DataTypes.ENUM("activity", "comment"), allowNull: false },
    actor: { type: DataTypes.STRING, allowNull: true },
    text: { type: DataTypes.TEXT, allowNull: false },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "record_events", underscored: true },
);
