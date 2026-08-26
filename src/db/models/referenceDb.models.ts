import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { sequelize } from "../sequelize";

/**
 * Enterprise "Database" reference registers (OD `ent-db-*`): Countries,
 * Education Levels, Industry Sectors, Sector Frameworks, Fields of Education.
 * Each org owns an editable copy — lazily seeded (see reference-db.service.ts)
 * from the immutable ISIC/NACE/ISCED-F datasets `/v1/reference` already
 * serves — matching OD's single-mutable-copy-per-instance model.
 */

export interface CountryRegion { name: string; cities: string[] }
// `code` is the national qualification code (OD's `level` field, e.g. "Jenjang 6",
// "AQF 3" — a framework-defined string, not a number). `level` is kept as a
// numeric ISCED-derived ordering key (least-breaking: existing callers that
// sort/compare `.level` as a number keep working); `isced` mirrors it as the
// ISCED 2011 level string, matching OD's `{level, label, isced}` triplet.
export interface CountryEduLevel { level: number; code: string; label: string; isced: string | null }
export interface CountrySectorLevel { code: string; label: string; isic: string | null; lv: number; parent: string | null }
export interface SectorFrameworkNode { code: string; label: string; lv: number; parent: string | null; isic: string | null }

export class ReferenceSectorFramework extends Model<InferAttributes<ReferenceSectorFramework>, InferCreationAttributes<ReferenceSectorFramework>> {
  declare id: CreationOptional<string>;
  declare orgId: string;
  declare name: string;
  declare region: string | null;
  declare levels: CreationOptional<SectorFrameworkNode[]>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
ReferenceSectorFramework.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: false, field: "org_id" },
    name: { type: DataTypes.STRING, allowNull: false },
    region: { type: DataTypes.STRING, allowNull: true },
    levels: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "reference_sector_frameworks", underscored: true },
);

export class ReferenceIndustrySector extends Model<InferAttributes<ReferenceIndustrySector>, InferCreationAttributes<ReferenceIndustrySector>> {
  declare id: CreationOptional<string>;
  declare orgId: string;
  declare code: string;
  declare label: string;
  declare level: number;
  declare parentId: string | null;
  declare description: string | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
ReferenceIndustrySector.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: false, field: "org_id" },
    code: { type: DataTypes.STRING, allowNull: false },
    label: { type: DataTypes.STRING, allowNull: false },
    level: { type: DataTypes.INTEGER, allowNull: false },
    parentId: { type: DataTypes.UUID, allowNull: true, field: "parent_id" },
    description: { type: DataTypes.TEXT, allowNull: true },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "reference_industry_sectors", underscored: true },
);

export class ReferenceEducationField extends Model<InferAttributes<ReferenceEducationField>, InferCreationAttributes<ReferenceEducationField>> {
  declare id: CreationOptional<string>;
  declare orgId: string;
  declare code: string;
  declare label: string;
  declare level: number;
  declare parentId: string | null;
  /** OD `eduFields[].extension` — true only when this field extends a parent (design only sets it when present). */
  declare extension: boolean | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
ReferenceEducationField.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: false, field: "org_id" },
    code: { type: DataTypes.STRING, allowNull: false },
    label: { type: DataTypes.STRING, allowNull: false },
    level: { type: DataTypes.INTEGER, allowNull: false },
    parentId: { type: DataTypes.UUID, allowNull: true, field: "parent_id" },
    extension: { type: DataTypes.BOOLEAN, allowNull: true },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "reference_education_fields", underscored: true },
);

export class ReferenceEducationLevel extends Model<InferAttributes<ReferenceEducationLevel>, InferCreationAttributes<ReferenceEducationLevel>> {
  declare id: CreationOptional<string>;
  declare orgId: string;
  declare level: number;
  declare label: string;
  declare description: string | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
ReferenceEducationLevel.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: false, field: "org_id" },
    level: { type: DataTypes.INTEGER, allowNull: false },
    label: { type: DataTypes.STRING, allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: true },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "reference_education_levels", underscored: true },
);

export class ReferenceCountry extends Model<InferAttributes<ReferenceCountry>, InferCreationAttributes<ReferenceCountry>> {
  declare id: CreationOptional<string>;
  declare orgId: string;
  declare code: string;
  declare name: string;
  declare currency: string | null;
  declare language: string | null;
  declare capital: string | null;
  declare eduFramework: string | null;
  declare sectorFramework: string | null;
  declare sectorFrameworkRef: string | null;
  declare regions: CreationOptional<CountryRegion[]>;
  declare eduLevels: CreationOptional<CountryEduLevel[]>;
  declare sectorLevels: CreationOptional<CountrySectorLevel[]>;
  declare edited: CreationOptional<boolean>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
ReferenceCountry.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: false, field: "org_id" },
    code: { type: DataTypes.STRING, allowNull: false },
    name: { type: DataTypes.STRING, allowNull: false },
    currency: { type: DataTypes.STRING, allowNull: true },
    language: { type: DataTypes.STRING, allowNull: true },
    capital: { type: DataTypes.STRING, allowNull: true },
    eduFramework: { type: DataTypes.STRING, allowNull: true, field: "edu_framework" },
    sectorFramework: { type: DataTypes.STRING, allowNull: true, field: "sector_framework" },
    sectorFrameworkRef: { type: DataTypes.UUID, allowNull: true, field: "sector_framework_ref" },
    regions: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    eduLevels: { type: DataTypes.JSONB, allowNull: false, defaultValue: [], field: "edu_levels" },
    sectorLevels: { type: DataTypes.JSONB, allowNull: false, defaultValue: [], field: "sector_levels" },
    edited: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "reference_countries", underscored: true },
);
