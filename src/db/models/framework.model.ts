import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { sequelize } from "../sequelize";

export type FrameworkStatus = "Draft" | "Published" | "Archived";

/**
 * A framework is a master-catalog entry that belongs to a framework family
 * (which in turn belongs to a framework type). Frameworks are platform-global
 * configuration managed only by the Service Owner.
 */
export class Framework extends Model<
  InferAttributes<Framework>,
  InferCreationAttributes<Framework>
> {
  declare id: CreationOptional<string>;
  declare familyId: string;
  declare code: string;
  declare name: string;
  declare version: string | null;
  declare status: CreationOptional<FrameworkStatus>;
  // DATEONLY surfaces as a "YYYY-MM-DD" string, not a Date.
  declare publishedDate: string | null;
  declare shortDescription: string | null;
  declare fullDescription: string | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

Framework.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    familyId: { type: DataTypes.UUID, allowNull: false, field: "family_id" },
    code: { type: DataTypes.STRING, allowNull: false, unique: true },
    name: { type: DataTypes.STRING, allowNull: false },
    version: { type: DataTypes.STRING, allowNull: true },
    status: { type: DataTypes.ENUM("Draft", "Published", "Archived"), allowNull: false, defaultValue: "Draft" },
    publishedDate: { type: DataTypes.DATEONLY, allowNull: true, field: "published_date" },
    shortDescription: { type: DataTypes.TEXT, allowNull: true, field: "short_description" },
    fullDescription: { type: DataTypes.TEXT, allowNull: true, field: "full_description" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "frameworks", underscored: true },
);
