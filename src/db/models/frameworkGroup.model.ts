import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { sequelize } from "../sequelize";

/**
 * A framework group classifies frameworks at the top level — in the AXIA model
 * these are "Standards" and "Regulations". Regulations carry jurisdictions on
 * their frameworks; standards do not. Platform-global master data.
 */
export class FrameworkGroup extends Model<
  InferAttributes<FrameworkGroup>,
  InferCreationAttributes<FrameworkGroup>
> {
  declare id: CreationOptional<string>;
  declare name: string;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

FrameworkGroup.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    name: { type: DataTypes.STRING, allowNull: false, unique: true },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "framework_groups", underscored: true },
);
