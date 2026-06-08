import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { sequelize } from "../sequelize";

/** The 8 Tenant Implementation registers, keyed by `module`. */
export type ImplementationModule =
  | "documents"
  | "compliance"
  | "risks"
  | "competence"
  | "objectives"
  | "audits"
  | "reviews"
  | "incidents";

export const IMPLEMENTATION_MODULES: ImplementationModule[] = [
  "documents",
  "compliance",
  "risks",
  "competence",
  "objectives",
  "audits",
  "reviews",
  "incidents",
];

/** Code prefix per module (business key, sequenced per tenant). */
export const MODULE_PREFIX: Record<ImplementationModule, string> = {
  documents: "DOC",
  compliance: "COM",
  risks: "RSK",
  competence: "CMP",
  objectives: "OBJ",
  audits: "AUD",
  reviews: "MRV",
  incidents: "INC",
};

/**
 * A single record in one of the tenant Implementation registers. `orgId` is the
 * tenant; `module` selects the register; `data` holds the module-specific fields
 * (e.g. likelihood/impact for risks). Status is STRING (mutable labels from the
 * module config). Code is a per-tenant `PREFIX-####` business key.
 */
export class ImplementationRecord extends Model<
  InferAttributes<ImplementationRecord>,
  InferCreationAttributes<ImplementationRecord>
> {
  declare id: CreationOptional<string>;
  declare orgId: string;
  declare module: ImplementationModule;
  declare code: string;
  declare title: string;
  declare status: CreationOptional<string>;
  declare owner: string | null;
  declare data: CreationOptional<Record<string, unknown>>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

ImplementationRecord.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: false, field: "org_id" },
    module: { type: DataTypes.STRING, allowNull: false },
    code: { type: DataTypes.STRING, allowNull: false },
    title: { type: DataTypes.STRING, allowNull: false },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Open" },
    owner: { type: DataTypes.STRING, allowNull: true },
    data: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "implementation_records", underscored: true },
);
