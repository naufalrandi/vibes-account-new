import { DataTypes, Model, type CreationOptional, type InferAttributes, type InferCreationAttributes } from "sequelize";
import { sequelize } from "../sequelize";

/**
 * Per-org competence governance settings — OD `compSettings` (index.html:13378).
 * Stored as one JSONB blob per organization; defaults are merged in the
 * service layer so a missing row (or a missing key) behaves exactly like OD's
 * lazily-initialised `db.compSettings` object. `defaultReassess` is a number
 * of months (see migration 0048 for why this deviates from OD's string enum);
 * the rest are booleans.
 */
export class CompetenceSettings extends Model<InferAttributes<CompetenceSettings>, InferCreationAttributes<CompetenceSettings>> {
  declare id: CreationOptional<string>;
  declare orgId: string;
  declare settings: CreationOptional<Record<string, boolean | number>>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
CompetenceSettings.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: false, unique: true, field: "org_id" },
    settings: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "competence_settings", underscored: true },
);
