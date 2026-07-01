import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { sequelize } from "../sequelize";

/**
 * A single row in any ISO clause register (`tn-m-*`). The `module` column is the
 * discriminator; module-specific fields live in the `data` JSONB blob. `elementId`
 * traces the entry to a Framework Element; `frameworks` records relevance.
 */
export class ImplementationRecord extends Model<
  InferAttributes<ImplementationRecord>,
  InferCreationAttributes<ImplementationRecord>
> {
  declare id: CreationOptional<string>;
  declare orgId: string;
  declare module: string;
  declare code: string;
  declare title: string;
  declare status: string;
  declare owner: string | null;
  declare data: CreationOptional<Record<string, unknown>>;
  declare elementId: string | null;
  declare frameworks: CreationOptional<string[]>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

ImplementationRecord.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: false, field: "org_id" },
    module: { type: DataTypes.STRING, allowNull: false },
    code: { type: DataTypes.STRING, allowNull: false },
    title: { type: DataTypes.STRING, allowNull: false },
    status: { type: DataTypes.STRING, allowNull: false },
    owner: { type: DataTypes.STRING, allowNull: true },
    data: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    elementId: { type: DataTypes.UUID, allowNull: true, field: "element_id" },
    frameworks: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "implementation_records", underscored: true },
);
