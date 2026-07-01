import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * Phase 11 — Knowledge base + notifications.
 *
 * `kb_articles`: help/guide articles (markdown), `org_id` NULL = global
 * (Service-Owner authored, visible to everyone). `notifications`: per-user or
 * org-wide bell items.
 */
export const up: Migration = async ({ context: q }) => {
  await q.createTable("kb_articles", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: { type: DataTypes.UUID, allowNull: true, references: { model: "organizations", key: "id" }, onDelete: "CASCADE" },
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
    unique_views: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    helpful: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    not_helpful: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    published_at: { type: DataTypes.DATE, allowNull: true },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
  await q.addIndex("kb_articles", ["org_id"]);
  await q.addIndex("kb_articles", ["category"]);

  await q.createTable("notifications", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: { type: DataTypes.UUID, allowNull: true, references: { model: "organizations", key: "id" }, onDelete: "CASCADE" },
    user_id: { type: DataTypes.UUID, allowNull: true, references: { model: "users", key: "id" }, onDelete: "CASCADE" },
    type: { type: DataTypes.STRING, allowNull: false, defaultValue: "info" },
    text: { type: DataTypes.STRING, allowNull: false },
    link: { type: DataTypes.STRING, allowNull: true },
    read: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
  await q.addIndex("notifications", ["org_id"]);
  await q.addIndex("notifications", ["user_id"]);
};

export const down: Migration = async ({ context: q }) => {
  await q.dropTable("notifications");
  await q.dropTable("kb_articles");
};
