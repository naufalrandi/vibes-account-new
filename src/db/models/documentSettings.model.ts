import { DataTypes, Model, type CreationOptional, type InferAttributes, type InferCreationAttributes } from "sequelize";
import { sequelize } from "../sequelize";

/**
 * Per-org controlled-document settings — OD `cdSettings` (app.html:24140).
 * Stored as one JSONB blob per organization; defaults are merged in the
 * service layer so a missing row (or a missing key) behaves exactly like OD's
 * lazily-initialised `db.cdSettings` object.
 */
export class DocumentSettings extends Model<InferAttributes<DocumentSettings>, InferCreationAttributes<DocumentSettings>> {
  declare id: CreationOptional<string>;
  declare orgId: string;
  declare settings: CreationOptional<Record<string, boolean>>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
DocumentSettings.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: false, unique: true, field: "org_id" },
    settings: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "document_settings", underscored: true },
);
