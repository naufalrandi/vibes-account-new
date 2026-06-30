import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { sequelize } from "../sequelize";
import type { AgreementBlock } from "./agreementTemplate.model";

export type PartnerAgreementStatus = "Draft" | "Pending Approval" | "Approved" | "Terminated";

export interface AgreementHistoryEntry {
  date: string;
  event: string;
}

/**
 * A per-partner agreement instance generated from a template (decision R8): the
 * filled variable values + a rendered block snapshot + a status-change history.
 * 1:1 with a Distributor org via `orgId` (the partner's current agreement);
 * regenerating replaces blocks/number and appends to `history`.
 */
export class PartnerAgreement extends Model<
  InferAttributes<PartnerAgreement>,
  InferCreationAttributes<PartnerAgreement>
> {
  declare id: CreationOptional<string>;
  declare orgId: string;
  declare templateId: string | null;
  declare templateName: string;
  declare number: string | null;
  declare version: CreationOptional<string>;
  declare status: CreationOptional<PartnerAgreementStatus>;
  declare effectiveDate: string | null;
  declare expirationDate: string | null;
  declare vars: CreationOptional<Record<string, string>>;
  declare renderedBlocks: CreationOptional<AgreementBlock[]>;
  declare history: CreationOptional<AgreementHistoryEntry[]>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

PartnerAgreement.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: false, unique: true, field: "org_id" },
    templateId: { type: DataTypes.UUID, allowNull: true, field: "template_id" },
    templateName: { type: DataTypes.STRING, allowNull: false, field: "template_name" },
    number: { type: DataTypes.STRING, allowNull: true },
    version: { type: DataTypes.STRING, allowNull: false, defaultValue: "v1.0" },
    status: {
      type: DataTypes.ENUM("Draft", "Pending Approval", "Approved", "Terminated"),
      allowNull: false,
      defaultValue: "Pending Approval",
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
