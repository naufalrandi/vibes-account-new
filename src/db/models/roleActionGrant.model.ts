import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { sequelize } from "../sequelize";

export class RoleActionGrant extends Model<InferAttributes<RoleActionGrant>, InferCreationAttributes<RoleActionGrant>> {
  declare id: CreationOptional<string>;
  declare roleId: string;
  declare actionId: string;
  declare granted: boolean;
}

RoleActionGrant.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    roleId: { type: DataTypes.UUID, allowNull: false, field: "role_id" },
    actionId: { type: DataTypes.UUID, allowNull: false, field: "action_id" },
    granted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  },
  {
    sequelize,
    tableName: "role_action_grants",
    underscored: true,
    timestamps: false,
    indexes: [{ unique: true, fields: ["role_id", "action_id"] }],
  },
);
