import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { sequelize } from "../sequelize";

/**
 * A tenant Work Unit (ISO 5.3 — organizational roles, responsibilities & authorities).
 * Scoped to a Site, it applies a set of Business Processes (the `processes` register),
 * Digital/Virtual Environments and External Dependencies (scope datasets, by id).
 * Mirrors the OD prototype's `renderWuStructure` register.
 */
export class WorkUnit extends Model<
  InferAttributes<WorkUnit>,
  InferCreationAttributes<WorkUnit>
> {
  declare id: CreationOptional<string>;
  declare orgId: string;
  declare code: string;
  declare name: string;
  declare siteId: string | null;
  declare status: string;
  declare description: string | null;
  declare processIds: CreationOptional<string[]>;
  declare envIds: CreationOptional<string[]>;
  declare depIds: CreationOptional<string[]>;
  declare createdBy: string | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

WorkUnit.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: false, field: "org_id" },
    code: { type: DataTypes.STRING, allowNull: false },
    name: { type: DataTypes.STRING, allowNull: false },
    siteId: { type: DataTypes.UUID, allowNull: true, field: "site_id" },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Applicable" },
    description: { type: DataTypes.TEXT, allowNull: true },
    processIds: { type: DataTypes.JSONB, allowNull: false, defaultValue: [], field: "process_ids" },
    envIds: { type: DataTypes.JSONB, allowNull: false, defaultValue: [], field: "env_ids" },
    depIds: { type: DataTypes.JSONB, allowNull: false, defaultValue: [], field: "dep_ids" },
    createdBy: { type: DataTypes.STRING, allowNull: true, field: "created_by" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "work_units", underscored: true },
);
