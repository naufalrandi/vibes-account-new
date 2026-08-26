import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * Web CMS module — Pages, Posts, Media, Menu items and per-org Settings.
 * Replaces the localStorage-only mockup with real org-scoped rows (mirrors
 * the `documents` module's shape: one table per entity, `org_id` scoped,
 * underscored columns).
 */
export const up: Migration = async ({ context: q }) => {
  await q.createTable("cms_pages", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: { type: DataTypes.UUID, allowNull: false, references: { model: "organizations", key: "id" }, onDelete: "CASCADE" },
    title: { type: DataTypes.STRING, allowNull: false },
    slug: { type: DataTypes.STRING, allowNull: false },
    path: { type: DataTypes.STRING, allowNull: true },
    template: { type: DataTypes.STRING, allowNull: false, defaultValue: "Landing" },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Draft" },
    author: { type: DataTypes.STRING, allowNull: true },
    seo_title: { type: DataTypes.STRING, allowNull: true },
    seo_desc: { type: DataTypes.STRING, allowNull: true },
    body: { type: DataTypes.TEXT, allowNull: false, defaultValue: "" },
    created_by: { type: DataTypes.STRING, allowNull: true },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
  await q.addIndex("cms_pages", ["org_id"]);
  await q.addIndex("cms_pages", ["org_id", "slug"], { unique: true, name: "cms_pages_org_id_slug_uq" });

  await q.createTable("cms_posts", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: { type: DataTypes.UUID, allowNull: false, references: { model: "organizations", key: "id" }, onDelete: "CASCADE" },
    title: { type: DataTypes.STRING, allowNull: false },
    slug: { type: DataTypes.STRING, allowNull: false },
    author: { type: DataTypes.STRING, allowNull: true },
    category: { type: DataTypes.STRING, allowNull: true },
    tags: { type: DataTypes.ARRAY(DataTypes.STRING), allowNull: false, defaultValue: [] },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Draft" },
    excerpt: { type: DataTypes.STRING, allowNull: true },
    body: { type: DataTypes.TEXT, allowNull: false, defaultValue: "" },
    publish_date: { type: DataTypes.DATE, allowNull: true },
    created_by: { type: DataTypes.STRING, allowNull: true },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
  await q.addIndex("cms_posts", ["org_id"]);
  await q.addIndex("cms_posts", ["org_id", "slug"], { unique: true, name: "cms_posts_org_id_slug_uq" });

  await q.createTable("cms_media", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: { type: DataTypes.UUID, allowNull: false, references: { model: "organizations", key: "id" }, onDelete: "CASCADE" },
    name: { type: DataTypes.STRING, allowNull: false },
    type: { type: DataTypes.STRING, allowNull: false },
    alt: { type: DataTypes.STRING, allowNull: true },
    size: { type: DataTypes.INTEGER, allowNull: false },
    url: { type: DataTypes.STRING, allowNull: false },
    uploaded_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    created_by: { type: DataTypes.STRING, allowNull: true },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
  await q.addIndex("cms_media", ["org_id"]);

  await q.createTable("cms_menu_items", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: { type: DataTypes.UUID, allowNull: false, references: { model: "organizations", key: "id" }, onDelete: "CASCADE" },
    label: { type: DataTypes.STRING, allowNull: false },
    page_id: { type: DataTypes.UUID, allowNull: true, references: { model: "cms_pages", key: "id" }, onDelete: "SET NULL" },
    url: { type: DataTypes.STRING, allowNull: true },
    order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
  await q.addIndex("cms_menu_items", ["org_id"]);

  await q.createTable("cms_settings", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: { type: DataTypes.UUID, allowNull: false, unique: true, references: { model: "organizations", key: "id" }, onDelete: "CASCADE" },
    site_name: { type: DataTypes.STRING, allowNull: true },
    domain: { type: DataTypes.STRING, allowNull: true },
    tagline: { type: DataTypes.STRING, allowNull: true },
    primary_color: { type: DataTypes.STRING, allowNull: true },
    seo_title: { type: DataTypes.STRING, allowNull: true },
    seo_desc: { type: DataTypes.STRING, allowNull: true },
    analytics: { type: DataTypes.STRING, allowNull: true },
    live: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
};

export const down: Migration = async ({ context: q }) => {
  await q.dropTable("cms_settings");
  await q.dropTable("cms_menu_items");
  await q.dropTable("cms_media");
  await q.dropTable("cms_posts");
  await q.dropTable("cms_pages");
};
