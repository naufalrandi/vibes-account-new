import { DataTypes, Model, type CreationOptional, type InferAttributes, type InferCreationAttributes } from "sequelize";
import { sequelize } from "../sequelize";

/**
 * Per-org CAB commercial settings — OD `db.cabRatePerMd` (js/modules.js:2204),
 * read by `cabRate()` and written only by `cabSetRate` ("Rate per man-day").
 *
 * R93: the man-day rate has to be a stored tenant setting, not a number the
 * proposal request carries. Reading it off the request body let any caller
 * price a certification proposal at a rate of their choosing.
 */
export class CabSettings extends Model<InferAttributes<CabSettings>, InferCreationAttributes<CabSettings>> {
  declare id: CreationOptional<string>;
  declare orgId: string;
  /** IDR per man-day. Null falls back to OD's 8,000,000 default. */
  declare ratePerMd: number | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
CabSettings.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: false, unique: true, field: "org_id" },
    ratePerMd: { type: DataTypes.BIGINT, allowNull: true, field: "rate_per_md" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "cab_settings", underscored: true },
);
