import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { sequelize } from "../sequelize";

export type KbStatus = "Draft" | "Published" | "Archived";

/** A knowledge-base article; `orgId` NULL = global (Service-Owner authored). */
export class KbArticle extends Model<InferAttributes<KbArticle>, InferCreationAttributes<KbArticle>> {
  declare id: CreationOptional<string>;
  declare orgId: string | null;
  declare code: string;
  declare title: string;
  declare category: string;
  declare status: CreationOptional<KbStatus>;
  declare author: CreationOptional<string>;
  declare summary: string | null;
  declare content: CreationOptional<string>;
  declare keywords: CreationOptional<string[]>;
  declare featured: CreationOptional<boolean>;
  declare views: CreationOptional<number>;
  declare uniqueViews: CreationOptional<number>;
  declare helpful: CreationOptional<number>;
  declare notHelpful: CreationOptional<number>;
  declare publishedAt: Date | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

KbArticle.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: true, field: "org_id" },
    code: { type: DataTypes.STRING, allowNull: false, unique: true },
    title: { type: DataTypes.STRING, allowNull: false },
    category: { type: DataTypes.STRING, allowNull: false },
    status: { type: DataTypes.ENUM("Draft", "Published", "Archived"), allowNull: false, defaultValue: "Draft" },
    author: { type: DataTypes.STRING, allowNull: false, defaultValue: "AXIA Support" },
    summary: { type: DataTypes.TEXT, allowNull: true },
    content: { type: DataTypes.TEXT, allowNull: false, defaultValue: "" },
    keywords: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    featured: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    views: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    uniqueViews: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: "unique_views" },
    helpful: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    notHelpful: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: "not_helpful" },
    publishedAt: { type: DataTypes.DATE, allowNull: true, field: "published_at" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "kb_articles", underscored: true },
);
