import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { sequelize } from "../sequelize";

export class Menu extends Model<InferAttributes<Menu>, InferCreationAttributes<Menu>> {
  declare id: CreationOptional<string>;
  declare parentId: string | null;
  declare name: string;
  declare heading: string | null;
  declare route: string | null;
  declare routeSeo: string | null;
  declare icon: string | null;
  declare sorting: CreationOptional<number>;
  declare status: CreationOptional<boolean>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

Menu.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    parentId: { type: DataTypes.UUID, allowNull: true, field: "parent_id" },
    name: { type: DataTypes.STRING, allowNull: false },
    heading: { type: DataTypes.STRING, allowNull: true },
    route: { type: DataTypes.STRING, allowNull: true },
    routeSeo: { type: DataTypes.STRING, allowNull: true, field: "route_seo" },
    icon: { type: DataTypes.STRING, allowNull: true },
    sorting: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    status: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "menus", underscored: true },
);
