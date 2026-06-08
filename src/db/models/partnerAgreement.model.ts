import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { sequelize } from "../sequelize";
import type { AgreementBlock } from "./agreementTemplate.model";

export type PartnerAgreementStatus = "Draft" | "Pending Approval" | "Approved" | "Terminated";

/** A timeline event on a partner agreement (generated / sent / approved / …). */
export interface AgreementHistoryEntry {
  date: string;
  event: string;
}

/** Stored variable values for a partner agreement instance (camelCase keys). */
export type AgreementVars = Record<string, string>;

/**
 * A partner-bound agreement instance generated from an AgreementTemplate. It
 * snapshots the template's version + blocks (with variables filled) at generation
 * time so the partner's copy is immutable until regenerated. `number` is null
 * while Draft and assigned (AGR-2026-####) on generation.
 */
export class PartnerAgreement extends Model<
  InferAttributes<PartnerAgreement>,
  InferCreationAttributes<PartnerAgreement>
> {
  declare id: CreationOptional<string>;
  declare orgId: string;
  declare agreementTemplateId: string;
  declare number: string | null;
  declare version: string;
  declare status: CreationOptional<PartnerAgreementStatus>;
  declare effectiveDate: string | null;
  declare expirationDate: string | null;
  declare vars: CreationOptional<AgreementVars>;
  declare renderedBlocks: CreationOptional<AgreementBlock[]>;
  declare history: CreationOptional<AgreementHistoryEntry[]>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

PartnerAgreement.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: false, field: "org_id" },
    agreementTemplateId: { type: DataTypes.UUID, allowNull: false, field: "agreement_template_id" },
    number: { type: DataTypes.STRING, allowNull: true, unique: true },
    version: { type: DataTypes.STRING, allowNull: false, defaultValue: "v1.0" },
    status: {
      type: DataTypes.ENUM("Draft", "Pending Approval", "Approved", "Terminated"),
      allowNull: false,
      defaultValue: "Draft",
    },
    effectiveDate: { type: DataTypes.DATEONLY, allowNull: true, field: "effective_date" },
    expirationDate: { type: DataTypes.DATEONLY, allowNull: true, field: "expiration_date" },
    vars: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    renderedBlocks: { type: DataTypes.JSONB, allowNull: false, defaultValue: [], field: "rendered_blocks" },
    history: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "partner_agreements", underscored: true },
);
