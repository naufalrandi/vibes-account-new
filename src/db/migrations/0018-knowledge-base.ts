import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * Phase 5 (Support) — the `kb_articles` table: the platform-global Knowledge Base.
 * Articles are master data authored by the Service Provider and read by every
 * persona once Published. `code` is a unique `KB-2026-####` business key.
 * `status` is STRING (Draft/Published/Archived) to avoid enum-migration churn;
 * `keywords` is a JSONB string[]; view/feedback counters are integers.
 */
export const up: Migration = async ({ context: q }) => {
  await q.createTable("kb_articles", {
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
    unique_views: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    helpful: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    not_helpful: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    published_at: { type: DataTypes.DATE, allowNull: true },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
  await q.addIndex("kb_articles", ["category"]);
  await q.addIndex("kb_articles", ["status"]);
};

export const down: Migration = async ({ context: q }) => {
  await q.dropTable("kb_articles");
};
