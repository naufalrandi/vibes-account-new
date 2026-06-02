import { DataTypes, Model } from "sequelize";
import { sequelize } from "../sequelize";

export class UserRole extends Model {
  declare userId: string;
  declare roleId: string;
}

UserRole.init(
  {
    userId: { type: DataTypes.UUID, primaryKey: true, field: "user_id" },
    roleId: { type: DataTypes.UUID, primaryKey: true, field: "role_id" },
  },
  { sequelize, tableName: "user_roles", underscored: true, timestamps: false },
);
