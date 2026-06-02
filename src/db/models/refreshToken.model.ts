import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { sequelize } from "../sequelize";

export class RefreshToken extends Model<InferAttributes<RefreshToken>, InferCreationAttributes<RefreshToken>> {
  declare id: CreationOptional<string>;
  declare userId: string;
  declare tokenHash: string;
  declare expiresAt: Date;
  declare revokedAt: Date | null;
}

RefreshToken.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    userId: { type: DataTypes.UUID, allowNull: false, field: "user_id" },
    tokenHash: { type: DataTypes.STRING, allowNull: false, field: "token_hash" },
    expiresAt: { type: DataTypes.DATE, allowNull: false, field: "expires_at" },
    revokedAt: { type: DataTypes.DATE, allowNull: true, field: "revoked_at" },
  },
  { sequelize, tableName: "refresh_tokens", underscored: true, timestamps: false },
);
