import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { sequelize } from "../sequelize";

export type FrameworkStatus = "Draft" | "Published" | "Active" | "Archived";

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
  // Catalog frameworks belong to a family; group-based meta-model frameworks
  // (Phase 7) carry a groupId instead, so both are nullable.
  declare familyId: string | null;
  declare code: string | null;
  declare name: string;
  declare version: string | null;
  declare status: CreationOptional<FrameworkStatus>;
  // DATEONLY surfaces as a "YYYY-MM-DD" string, not a Date.
  declare publishedDate: string | null;
  declare shortDescription: string | null;
  declare fullDescription: string | null;
  // Phase 7 meta-model fields.
  declare groupId: string | null;
  declare jurisdictions: CreationOptional<string[]>;
  /** OD Short Label — compact register tag (e.g. "9001"); null = auto-derive. */
  declare shortLabel: string | null;
  /** OD `frameworks[].disciplineId` — the owning discipline/category id, SP master data. */
  declare disciplineId: string | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

Framework.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    familyId: { type: DataTypes.UUID, allowNull: true, field: "family_id" },
    code: { type: DataTypes.STRING, allowNull: true, unique: true },
    name: { type: DataTypes.STRING, allowNull: false },
    version: { type: DataTypes.STRING, allowNull: true },
    status: { type: DataTypes.ENUM("Draft", "Published", "Active", "Archived"), allowNull: false, defaultValue: "Draft" },
    publishedDate: { type: DataTypes.DATEONLY, allowNull: true, field: "published_date" },
    shortDescription: { type: DataTypes.TEXT, allowNull: true, field: "short_description" },
    fullDescription: { type: DataTypes.TEXT, allowNull: true, field: "full_description" },
    groupId: { type: DataTypes.UUID, allowNull: true, field: "group_id" },
    jurisdictions: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    shortLabel: { type: DataTypes.STRING, allowNull: true, field: "short_label" },
    disciplineId: { type: DataTypes.STRING, allowNull: true, field: "discipline_id" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "frameworks", underscored: true },
);
