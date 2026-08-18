import { DataTypes, Model, type CreationOptional, type InferAttributes, type InferCreationAttributes } from "sequelize";
import { sequelize } from "../sequelize";

/**
 * Per-org awareness governance settings — OD `awSettings` (index.html:14240).
 * Stored as one JSONB blob per organization; defaults are merged in the
 * service layer so a missing row (or a missing key) behaves exactly like OD's
 * lazily-initialised `db.awSettings` object. `reminderFreq` is a string
 * (OD: "Once before due date" | "Daily after overdue" | …), the rest booleans.
 */
export class AwarenessSettings extends Model<InferAttributes<AwarenessSettings>, InferCreationAttributes<AwarenessSettings>> {
  declare id: CreationOptional<string>;
  declare orgId: string;
  declare settings: CreationOptional<Record<string, boolean | string>>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
AwarenessSettings.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: false, unique: true, field: "org_id" },
    settings: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "awareness_settings", underscored: true },
);
