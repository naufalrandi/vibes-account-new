import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { sequelize } from "../sequelize";

/**
 * Interested Parties (ISO 4.2) — parties and their requirements sub-register.
 * A requirement can be raised as a Risk (into the risks register) and linked to
 * Compliance Obligations. Party display status is derived from its requirements.
 */
export const IP_CATEGORIES = ["Employees", "Regulators", "Suppliers", "Clients or Customers", "End Users", "Community", "Competitors", "Shareholders"] as const;
export const IP_REQ_TYPES = ["Need", "Expectation", "Requirement", "Legal / Regulatory Requirement", "Contractual Requirement", "Customer Requirement", "Other"] as const;
export const IP_PARTY_STATUS = ["Active", "Under Review", "Archived"] as const;
export const IP_REQ_STATUS = ["Open", "Under Review", "Addressed", "On Hold", "Dismissed", "Archived"] as const;

export interface IpActivityEntry { ts: string; user: string; action: string; summary?: string }
export interface IpComment { id: string; user: string; ts: string; text: string }

export class IpParty extends Model<InferAttributes<IpParty>, InferCreationAttributes<IpParty>> {
  declare id: CreationOptional<string>;
  declare orgId: string;
  declare code: string;
  declare name: string;
  declare category: string;
  declare description: string | null;
  declare frameworks: CreationOptional<string[]>;
  declare status: CreationOptional<string>;
  declare createdBy: string | null;
  declare lastUpdatedBy: string | null;
  declare activity: CreationOptional<IpActivityEntry[]>;
  declare comments: CreationOptional<IpComment[]>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
IpParty.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: false, field: "org_id" },
    code: { type: DataTypes.STRING, allowNull: false, unique: true },
    name: { type: DataTypes.STRING, allowNull: false },
    category: { type: DataTypes.STRING, allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: true },
    frameworks: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Active" },
    createdBy: { type: DataTypes.STRING, allowNull: true, field: "created_by" },
    lastUpdatedBy: { type: DataTypes.STRING, allowNull: true, field: "last_updated_by" },
    activity: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    comments: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "ip_parties", underscored: true },
);

export class IpRequirement extends Model<InferAttributes<IpRequirement>, InferCreationAttributes<IpRequirement>> {
  declare id: CreationOptional<string>;
  declare orgId: string;
  declare code: string;
  declare partyId: string;
  declare topic: string;
  declare description: string | null;
  declare type: CreationOptional<string>;
  declare frameworks: CreationOptional<string[]>;
  declare relatedCO: CreationOptional<boolean>;
  declare linkedObligations: CreationOptional<string[]>;
  declare status: CreationOptional<string>;
  declare raisedAsRisk: CreationOptional<boolean>;
  declare dismissJustification: string | null;
  declare holdJustification: string | null;
  declare archiveJustification: string | null;
  declare decidedBy: string | null;
  declare decidedAt: string | null;
  declare archivedBy: string | null;
  declare archivedAt: string | null;
  declare createdBy: string | null;
  declare lastUpdatedBy: string | null;
  declare activity: CreationOptional<IpActivityEntry[]>;
  declare comments: CreationOptional<IpComment[]>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
IpRequirement.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: false, field: "org_id" },
    code: { type: DataTypes.STRING, allowNull: false, unique: true },
    partyId: { type: DataTypes.UUID, allowNull: false, field: "party_id" },
    topic: { type: DataTypes.STRING, allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: true },
    type: { type: DataTypes.STRING, allowNull: false, defaultValue: "Requirement" },
    frameworks: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    relatedCO: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: "related_co" },
    linkedObligations: { type: DataTypes.JSONB, allowNull: false, defaultValue: [], field: "linked_obligations" },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Open" },
    raisedAsRisk: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: "raised_as_risk" },
    dismissJustification: { type: DataTypes.TEXT, allowNull: true, field: "dismiss_justification" },
    holdJustification: { type: DataTypes.TEXT, allowNull: true, field: "hold_justification" },
    archiveJustification: { type: DataTypes.TEXT, allowNull: true, field: "archive_justification" },
    decidedBy: { type: DataTypes.STRING, allowNull: true, field: "decided_by" },
    decidedAt: { type: DataTypes.STRING, allowNull: true, field: "decided_at" },
    archivedBy: { type: DataTypes.STRING, allowNull: true, field: "archived_by" },
    archivedAt: { type: DataTypes.STRING, allowNull: true, field: "archived_at" },
    createdBy: { type: DataTypes.STRING, allowNull: true, field: "created_by" },
    lastUpdatedBy: { type: DataTypes.STRING, allowNull: true, field: "last_updated_by" },
    activity: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    comments: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "ip_requirements", underscored: true },
);
