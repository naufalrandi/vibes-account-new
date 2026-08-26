import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { sequelize } from "../sequelize";

export type CmsPageTemplate = "Home" | "Pricing" | "Contact" | "Landing";
export type CmsPageStatus = "Draft" | "InReview" | "Published" | "Archived";
export type CmsPostStatus = "Draft" | "InReview" | "Published" | "Archived" | "Scheduled";

/** A CMS page — org-scoped, plain-text/HTML `body` (no block editor). */
export class CmsPage extends Model<InferAttributes<CmsPage>, InferCreationAttributes<CmsPage>> {
  declare id: CreationOptional<string>;
  declare orgId: string;
  declare title: string;
  declare slug: string;
  declare path: string | null;
  declare template: CmsPageTemplate;
  declare status: CreationOptional<CmsPageStatus>;
  declare author: string | null;
  declare seoTitle: string | null;
  declare seoDesc: string | null;
  declare body: string;
  declare createdBy: string | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

CmsPage.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: false, field: "org_id" },
    title: { type: DataTypes.STRING, allowNull: false },
    slug: { type: DataTypes.STRING, allowNull: false },
    path: { type: DataTypes.STRING, allowNull: true },
    template: { type: DataTypes.ENUM("Home", "Pricing", "Contact", "Landing"), allowNull: false, defaultValue: "Landing" },
    status: { type: DataTypes.ENUM("Draft", "InReview", "Published", "Archived"), allowNull: false, defaultValue: "Draft" },
    author: { type: DataTypes.STRING, allowNull: true },
    seoTitle: { type: DataTypes.STRING, allowNull: true, field: "seo_title" },
    seoDesc: { type: DataTypes.STRING, allowNull: true, field: "seo_desc" },
    body: { type: DataTypes.TEXT, allowNull: false, defaultValue: "" },
    createdBy: { type: DataTypes.STRING, allowNull: true, field: "created_by" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "cms_pages", underscored: true },
);

/** A CMS blog post — org-scoped; `Scheduled` becomes publicly visible once `publishDate` passes (checked in the public read path, no cron). */
export class CmsPost extends Model<InferAttributes<CmsPost>, InferCreationAttributes<CmsPost>> {
  declare id: CreationOptional<string>;
  declare orgId: string;
  declare title: string;
  declare slug: string;
  declare author: string | null;
  declare category: string | null;
  declare tags: CreationOptional<string[]>;
  declare status: CreationOptional<CmsPostStatus>;
  declare excerpt: string | null;
  declare body: string;
  declare publishDate: Date | null;
  declare createdBy: string | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

CmsPost.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: false, field: "org_id" },
    title: { type: DataTypes.STRING, allowNull: false },
    slug: { type: DataTypes.STRING, allowNull: false },
    author: { type: DataTypes.STRING, allowNull: true },
    category: { type: DataTypes.STRING, allowNull: true },
    tags: { type: DataTypes.ARRAY(DataTypes.STRING), allowNull: false, defaultValue: [] },
    status: { type: DataTypes.ENUM("Draft", "InReview", "Published", "Archived", "Scheduled"), allowNull: false, defaultValue: "Draft" },
    excerpt: { type: DataTypes.STRING, allowNull: true },
    body: { type: DataTypes.TEXT, allowNull: false, defaultValue: "" },
    publishDate: { type: DataTypes.DATE, allowNull: true, field: "publish_date" },
    createdBy: { type: DataTypes.STRING, allowNull: true, field: "created_by" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "cms_posts", underscored: true },
);

/** An uploaded media asset — real file on disk under uploads/cms/<orgId>/, served via express.static. */
export class CmsMedia extends Model<InferAttributes<CmsMedia>, InferCreationAttributes<CmsMedia>> {
  declare id: CreationOptional<string>;
  declare orgId: string;
  declare name: string;
  declare type: string;
  declare alt: string | null;
  declare size: number;
  declare url: string;
  declare uploadedAt: CreationOptional<Date>;
  declare createdBy: string | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

CmsMedia.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: false, field: "org_id" },
    name: { type: DataTypes.STRING, allowNull: false },
    type: { type: DataTypes.STRING, allowNull: false },
    alt: { type: DataTypes.STRING, allowNull: true },
    size: { type: DataTypes.INTEGER, allowNull: false },
    url: { type: DataTypes.STRING, allowNull: false },
    uploadedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: "uploaded_at" },
    createdBy: { type: DataTypes.STRING, allowNull: true, field: "created_by" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "cms_media", underscored: true },
);

/** A nav entry on the org's public site — points at either an internal page or an external url. */
export class CmsMenuItem extends Model<InferAttributes<CmsMenuItem>, InferCreationAttributes<CmsMenuItem>> {
  declare id: CreationOptional<string>;
  declare orgId: string;
  declare label: string;
  declare pageId: string | null;
  declare url: string | null;
  declare order: CreationOptional<number>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

CmsMenuItem.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: false, field: "org_id" },
    label: { type: DataTypes.STRING, allowNull: false },
    pageId: { type: DataTypes.UUID, allowNull: true, field: "page_id" },
    url: { type: DataTypes.STRING, allowNull: true },
    order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "cms_menu_items", underscored: true },
);

/** Singleton-per-org site settings row; GET returns-or-creates the default, PUT upserts. */
export class CmsSettings extends Model<InferAttributes<CmsSettings>, InferCreationAttributes<CmsSettings>> {
  declare id: CreationOptional<string>;
  declare orgId: string;
  declare siteName: string | null;
  declare domain: string | null;
  declare tagline: string | null;
  declare primaryColor: string | null;
  declare seoTitle: string | null;
  declare seoDesc: string | null;
  declare analytics: string | null;
  declare live: CreationOptional<boolean>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

CmsSettings.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: false, unique: true, field: "org_id" },
    siteName: { type: DataTypes.STRING, allowNull: true, field: "site_name" },
    domain: { type: DataTypes.STRING, allowNull: true },
    tagline: { type: DataTypes.STRING, allowNull: true },
    primaryColor: { type: DataTypes.STRING, allowNull: true, field: "primary_color" },
    seoTitle: { type: DataTypes.STRING, allowNull: true, field: "seo_title" },
    seoDesc: { type: DataTypes.STRING, allowNull: true, field: "seo_desc" },
    analytics: { type: DataTypes.STRING, allowNull: true },
    live: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "cms_settings", underscored: true },
);
