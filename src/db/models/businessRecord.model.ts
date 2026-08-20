import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { sequelize } from "../sequelize";

export type BusinessArea = "enterprise" | "datana" | "motoran" | "exelera";

/**
 * A row in any Business Unit register (Enterprise ERP, Datana, Motoran,
 * Exelera). The
 * `area` + `module` columns are the discriminators; module-specific fields live
 * in the `data` JSONB blob. Records belong to the operating-company org that
 * created them (the Service Provider's internal business units).
 */
export class BusinessRecord extends Model<
  InferAttributes<BusinessRecord>,
  InferCreationAttributes<BusinessRecord>
> {
  declare id: CreationOptional<string>;
  declare orgId: string;
  declare area: BusinessArea;
  declare module: string;
  declare code: string;
  declare title: string;
  declare status: string;
  declare owner: string | null;
  declare data: CreationOptional<Record<string, unknown>>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

BusinessRecord.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: false, field: "org_id" },
    area: { type: DataTypes.ENUM("enterprise", "datana", "motoran", "exelera"), allowNull: false },
    module: { type: DataTypes.STRING, allowNull: false },
    code: { type: DataTypes.STRING, allowNull: false },
    title: { type: DataTypes.STRING, allowNull: false },
    status: { type: DataTypes.STRING, allowNull: false },
    owner: { type: DataTypes.STRING, allowNull: true },
    data: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "business_records", underscored: true },
);
