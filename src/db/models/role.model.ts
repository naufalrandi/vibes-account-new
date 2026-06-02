import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { sequelize } from "../sequelize";

export class Role extends Model<InferAttributes<Role>, InferCreationAttributes<Role>> {
  declare id: CreationOptional<string>;
  declare name: string;
  declare tierScope: "ServiceOwner" | "Distributor" | "Tenant";
  declare orgId: string | null;
  declare isSuperAdmin: CreationOptional<boolean>;
  declare status: CreationOptional<boolean>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

Role.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    name: { type: DataTypes.STRING, allowNull: false },
    tierScope: { type: DataTypes.ENUM("ServiceOwner", "Distributor", "Tenant"), allowNull: false, field: "tier_scope" },
    orgId: { type: DataTypes.UUID, allowNull: true, field: "org_id" },
    isSuperAdmin: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: "is_super_admin" },
    status: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "roles", underscored: true },
);
