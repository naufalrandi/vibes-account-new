import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * Enterprise "Database" reference registers (OD `ent-db-*`): Countries,
 * Education Levels, Industry Sectors, Sector Frameworks, Fields of Education.
 * Each org gets its own editable copy (lazily seeded on first read from the
 * immutable ISIC/NACE/ISCED-F datasets already served by `/v1/reference`),
 * matching OD's single-mutable-copy model. Tree parent links (`parent_id`)
 * are loose string references, not FKs — these are 700+ node trees and OD
 * itself has no referential-integrity constraint on them either.
 */
export const up: Migration = async ({ context: q }) => {
  await q.createTable("reference_sector_frameworks", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: { type: DataTypes.UUID, allowNull: false, references: { model: "organizations", key: "id" }, onDelete: "CASCADE" },
    name: { type: DataTypes.STRING, allowNull: false },
    region: { type: DataTypes.STRING, allowNull: true },
    levels: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
  await q.addIndex("reference_sector_frameworks", ["org_id"]);

  await q.createTable("reference_industry_sectors", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: { type: DataTypes.UUID, allowNull: false, references: { model: "organizations", key: "id" }, onDelete: "CASCADE" },
    code: { type: DataTypes.STRING, allowNull: false },
    label: { type: DataTypes.STRING, allowNull: false },
    level: { type: DataTypes.INTEGER, allowNull: false },
    parent_id: { type: DataTypes.UUID, allowNull: true },
    description: { type: DataTypes.TEXT, allowNull: true },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
  await q.addIndex("reference_industry_sectors", ["org_id"]);
  await q.addIndex("reference_industry_sectors", ["org_id", "code"], { unique: true });
  await q.addIndex("reference_industry_sectors", ["parent_id"]);

  await q.createTable("reference_education_fields", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: { type: DataTypes.UUID, allowNull: false, references: { model: "organizations", key: "id" }, onDelete: "CASCADE" },
    code: { type: DataTypes.STRING, allowNull: false },
    label: { type: DataTypes.STRING, allowNull: false },
    level: { type: DataTypes.INTEGER, allowNull: false },
    parent_id: { type: DataTypes.UUID, allowNull: true },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
  await q.addIndex("reference_education_fields", ["org_id"]);
  await q.addIndex("reference_education_fields", ["org_id", "code"], { unique: true });
  await q.addIndex("reference_education_fields", ["parent_id"]);

  await q.createTable("reference_education_levels", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: { type: DataTypes.UUID, allowNull: false, references: { model: "organizations", key: "id" }, onDelete: "CASCADE" },
    level: { type: DataTypes.INTEGER, allowNull: false },
    label: { type: DataTypes.STRING, allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: true },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
  await q.addIndex("reference_education_levels", ["org_id"]);
  await q.addIndex("reference_education_levels", ["org_id", "level"], { unique: true });

  await q.createTable("reference_countries", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: { type: DataTypes.UUID, allowNull: false, references: { model: "organizations", key: "id" }, onDelete: "CASCADE" },
    code: { type: DataTypes.STRING, allowNull: false },
    name: { type: DataTypes.STRING, allowNull: false },
    currency: { type: DataTypes.STRING, allowNull: true },
    language: { type: DataTypes.STRING, allowNull: true },
    capital: { type: DataTypes.STRING, allowNull: true },
    edu_framework: { type: DataTypes.STRING, allowNull: true },
    sector_framework: { type: DataTypes.STRING, allowNull: true },
    sector_framework_ref: { type: DataTypes.UUID, allowNull: true, references: { model: "reference_sector_frameworks", key: "id" }, onDelete: "SET NULL" },
    regions: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    edu_levels: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    sector_levels: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    edited: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
  await q.addIndex("reference_countries", ["org_id"]);
  await q.addIndex("reference_countries", ["org_id", "code"], { unique: true });
};

export const down: Migration = async ({ context: q }) => {
  await q.dropTable("reference_countries");
  await q.dropTable("reference_education_levels");
  await q.dropTable("reference_education_fields");
  await q.dropTable("reference_industry_sectors");
  await q.dropTable("reference_sector_frameworks");
};
