import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * Documents module — Internal Documents (block-editor content) and External
 * Documents (folder-tree browser). `document_folders` holds the External
 * tree; `documents` covers both kinds via `kind`, with `folder_id` only
 * meaningful for `external` rows and `content` (block array) only meaningful
 * for `internal` rows.
 */
export const up: Migration = async ({ context: q }) => {
  await q.createTable("document_folders", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: { type: DataTypes.UUID, allowNull: false, references: { model: "organizations", key: "id" }, onDelete: "CASCADE" },
    name: { type: DataTypes.STRING, allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: true },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Active" },
    created_by: { type: DataTypes.STRING, allowNull: true },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
  await q.addIndex("document_folders", ["org_id"]);

  await q.createTable("documents", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: { type: DataTypes.UUID, allowNull: false, references: { model: "organizations", key: "id" }, onDelete: "CASCADE" },
    kind: { type: DataTypes.STRING, allowNull: false },
    title: { type: DataTypes.STRING, allowNull: false },
    doc_type: { type: DataTypes.STRING, allowNull: true },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Draft" },
    version: { type: DataTypes.STRING, allowNull: false, defaultValue: "0.1" },
    content: { type: DataTypes.JSONB, allowNull: true },
    folder_id: { type: DataTypes.UUID, allowNull: true, references: { model: "document_folders", key: "id" }, onDelete: "SET NULL" },
    issuer: { type: DataTypes.STRING, allowNull: true },
    link: { type: DataTypes.STRING, allowNull: true },
    effective_date: { type: DataTypes.DATEONLY, allowNull: true },
    next_review: { type: DataTypes.DATEONLY, allowNull: true },
    owner: { type: DataTypes.STRING, allowNull: true },
    notes: { type: DataTypes.TEXT, allowNull: true },
    created_by: { type: DataTypes.STRING, allowNull: true },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
  await q.addIndex("documents", ["org_id"]);
  await q.addIndex("documents", ["kind"]);
  await q.addIndex("documents", ["folder_id"]);
};

export const down: Migration = async ({ context: q }) => {
  await q.dropTable("documents");
  await q.dropTable("document_folders");
};
