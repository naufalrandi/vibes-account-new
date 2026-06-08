import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { sequelize } from "../sequelize";

export type KbStatus = "Draft" | "Published" | "Archived";
export const KB_STATUSES: KbStatus[] = ["Draft", "Published", "Archived"];

/**
 * A Knowledge Base article — platform-global help content authored by the Service
 * Provider and read by every persona once Published. `code` is a `KB-2026-####`
 * business key; `content` is markdown; `category` references the fixed
 * KB_CATEGORIES catalog. View/feedback counters drive the KB analytics dashboard.
 */
export class KbArticle extends Model<InferAttributes<KbArticle>, InferCreationAttributes<KbArticle>> {
  declare id: CreationOptional<string>;
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
  declare publishedAt: CreationOptional<Date | null>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

KbArticle.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    code: { type: DataTypes.STRING, allowNull: false, unique: true },
    title: { type: DataTypes.STRING, allowNull: false },
    category: { type: DataTypes.STRING, allowNull: false },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Draft" },
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
