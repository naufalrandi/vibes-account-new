import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { sequelize } from "../sequelize";

export class RoleMenuGrant extends Model<InferAttributes<RoleMenuGrant>, InferCreationAttributes<RoleMenuGrant>> {
  declare id: CreationOptional<string>;
  declare roleId: string;
  declare menuId: string;
  declare granted: boolean;
}

RoleMenuGrant.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    roleId: { type: DataTypes.UUID, allowNull: false, field: "role_id" },
    menuId: { type: DataTypes.UUID, allowNull: false, field: "menu_id" },
    granted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  },
  {
    sequelize,
    tableName: "role_menu_grants",
    underscored: true,
    timestamps: false,
    indexes: [{ unique: true, fields: ["role_id", "menu_id"] }],
  },
);
