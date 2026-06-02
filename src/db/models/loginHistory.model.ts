import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { sequelize } from "../sequelize";

export class LoginHistory extends Model<InferAttributes<LoginHistory>, InferCreationAttributes<LoginHistory>> {
  declare id: CreationOptional<string>;
  declare userId: string | null;
  declare at: CreationOptional<Date>;
  declare sourceIp: string | null;
  declare result: "Success" | "Failure";
}

LoginHistory.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    userId: { type: DataTypes.UUID, allowNull: true, field: "user_id" },
    at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    sourceIp: { type: DataTypes.STRING, allowNull: true, field: "source_ip" },
    result: { type: DataTypes.ENUM("Success", "Failure"), allowNull: false },
  },
  { sequelize, tableName: "login_history", underscored: true, timestamps: false },
);
