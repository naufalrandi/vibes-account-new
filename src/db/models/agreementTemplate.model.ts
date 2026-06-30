import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { sequelize } from "../sequelize";

export type AgreementTemplateStatus = "Draft" | "Active" | "Archived";
export type AgreementBlockType = "heading" | "paragraph" | "clause" | "bullet" | "divider" | "signature";

export interface AgreementBlock {
  id: string;
  type: AgreementBlockType;
  text: string;
}

/**
 * A reusable partnership-agreement template (decision R8): structured `blocks`
 * with `{{variable}}` tokens, never rendered HTML. ServiceOwner master data,
 * scoped to the owning org.
 */
export class AgreementTemplate extends Model<
  InferAttributes<AgreementTemplate>,
  InferCreationAttributes<AgreementTemplate>
> {
  declare id: CreationOptional<string>;
  declare orgId: string;
  declare code: string;
  declare name: string;
  declare description: string | null;
  declare version: CreationOptional<string>;
  declare status: CreationOptional<AgreementTemplateStatus>;
  declare blocks: CreationOptional<AgreementBlock[]>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

AgreementTemplate.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: false, field: "org_id" },
    code: { type: DataTypes.STRING, allowNull: false, unique: true },
    name: { type: DataTypes.STRING, allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: true },
    version: { type: DataTypes.STRING, allowNull: false, defaultValue: "v1.0" },
    status: { type: DataTypes.ENUM("Draft", "Active", "Archived"), allowNull: false, defaultValue: "Draft" },
    blocks: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "agreement_templates", underscored: true },
);
