import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { sequelize } from "../sequelize";

export type BusinessArea = "enterprise" | "datana" | "motoran";
export const BUSINESS_AREAS: BusinessArea[] = ["enterprise", "datana", "motoran"];

/**
 * A single record in one of the operating company's Business Unit modules
 * (Enterprise ERP, Datana, Motoran). Owned by the Service Owner org. `area` +
 * `module` select the register; `data` holds the module-specific fields. `code`
 * is a per-(area,module) `PREFIX-####` business key.
 */
export class BusinessRecord extends Model<InferAttributes<BusinessRecord>, InferCreationAttributes<BusinessRecord>> {
  declare id: CreationOptional<string>;
  declare orgId: string;
  declare area: BusinessArea;
  declare module: string;
  declare code: string;
  declare title: string;
  declare status: CreationOptional<string>;
  declare owner: string | null;
  declare data: CreationOptional<Record<string, unknown>>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

BusinessRecord.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: false, field: "org_id" },
    area: { type: DataTypes.STRING, allowNull: false },
    module: { type: DataTypes.STRING, allowNull: false },
    code: { type: DataTypes.STRING, allowNull: false },
    title: { type: DataTypes.STRING, allowNull: false },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Open" },
    owner: { type: DataTypes.STRING, allowNull: true },
    data: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "business_records", underscored: true },
);
