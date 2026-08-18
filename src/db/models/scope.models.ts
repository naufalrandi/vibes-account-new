import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { sequelize } from "../sequelize";

/**
 * Management System Scope. `ScopeDataset` is the SP-owned master pick-list
 * (virtual environments / personnel types / dependencies) the scope dimensions
 * choose from. `MsScope` (later slice) is the versioned 6-dimension scope doc.
 */
export const SCOPE_DSTAT = ["Included", "Excluded", "Partially Included", "Not Applicable"] as const;
export const MS_SCOPESTAT = ["Draft", "Under Review", "Approved", "Active", "Superseded", "Archived"] as const;
export const MS_REVFREQ = ["Monthly", "Quarterly", "Semi-annually", "Annually", "Custom"] as const;

export const SCOPE_DIMS = ["frameworks", "sites", "processes", "envs", "personnel", "deps"] as const;
export type ScopeDim = (typeof SCOPE_DIMS)[number];

export interface ScopeDimRow { name: string; status: string; note: string; cat?: string }
export interface ScopeCounts { standards: number; sites: number; users: number }
export interface ScopeBaseline { version: number; capturedAt: string; capturedBy: string; counts: ScopeCounts; snapshot: Record<string, ScopeDimRow[]> }
export interface ScopeDiffEntry { billable: boolean; kind: string; action: string; label: string }
export interface ScopePendingChange { stage: string; raisedBy: string; raisedAt: string; entries: ScopeDiffEntry[]; snapshot: Record<string, ScopeDimRow[]>; partnerBy?: string; partnerAt?: string }
export interface ScopeActivityEntry { ts: string; user: string; action: string; summary?: string }

export class MsScope extends Model<InferAttributes<MsScope>, InferCreationAttributes<MsScope>> {
  declare id: CreationOptional<string>;
  /** Shared by the original scope and every clone `spApprove` supersedes it
   * with, so version history can be traced across the `code` changes that
   * each re-baseline clone gets. See migration 0041. */
  declare lineageId: string;
  declare orgId: string;
  declare code: string;
  declare name: string;
  declare owner: string | null;
  declare effectiveDate: string | null;
  declare reviewFreq: CreationOptional<string>;
  declare status: CreationOptional<string>;
  declare frameworks: CreationOptional<ScopeDimRow[]>;
  declare sites: CreationOptional<ScopeDimRow[]>;
  declare processes: CreationOptional<ScopeDimRow[]>;
  declare envs: CreationOptional<ScopeDimRow[]>;
  declare personnel: CreationOptional<ScopeDimRow[]>;
  declare deps: CreationOptional<ScopeDimRow[]>;
  declare statement: string | null;
  declare limitations: string | null;
  declare approvalNotes: string | null;
  declare frameworkRelevance: CreationOptional<string[]>;
  declare approvedBy: string | null;
  declare approvedDate: string | null;
  declare version: CreationOptional<number>;
  declare baseline: ScopeBaseline | null;
  declare pendingChange: ScopePendingChange | null;
  declare supersededAt: string | null;
  declare supersededBy: string | null;
  declare supersededByVersion: number | null;
  declare createdBy: string | null;
  declare activity: CreationOptional<ScopeActivityEntry[]>;
  declare comments: CreationOptional<{ id: string; user: string; ts: string; text: string }[]>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
MsScope.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    lineageId: { type: DataTypes.UUID, allowNull: false, field: "lineage_id" },
    orgId: { type: DataTypes.UUID, allowNull: false, field: "org_id" },
    code: { type: DataTypes.STRING, allowNull: false, unique: true },
    name: { type: DataTypes.STRING, allowNull: false },
    owner: { type: DataTypes.STRING, allowNull: true },
    effectiveDate: { type: DataTypes.DATEONLY, allowNull: true, field: "effective_date" },
    reviewFreq: { type: DataTypes.STRING, allowNull: false, defaultValue: "Annually", field: "review_freq" },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Draft" },
    frameworks: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    sites: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    processes: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    envs: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    personnel: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    deps: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    statement: { type: DataTypes.TEXT, allowNull: true },
    limitations: { type: DataTypes.TEXT, allowNull: true },
    approvalNotes: { type: DataTypes.TEXT, allowNull: true, field: "approval_notes" },
    frameworkRelevance: { type: DataTypes.JSONB, allowNull: false, defaultValue: [], field: "framework_relevance" },
    approvedBy: { type: DataTypes.STRING, allowNull: true, field: "approved_by" },
    approvedDate: { type: DataTypes.DATEONLY, allowNull: true, field: "approved_date" },
    version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    baseline: { type: DataTypes.JSONB, allowNull: true },
    pendingChange: { type: DataTypes.JSONB, allowNull: true, field: "pending_change" },
    supersededAt: { type: DataTypes.STRING, allowNull: true, field: "superseded_at" },
    supersededBy: { type: DataTypes.STRING, allowNull: true, field: "superseded_by" },
    supersededByVersion: { type: DataTypes.INTEGER, allowNull: true, field: "superseded_by_version" },
    createdBy: { type: DataTypes.STRING, allowNull: true, field: "created_by" },
    activity: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    comments: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "ms_scopes", underscored: true },
);

export class ScopeDataset extends Model<InferAttributes<ScopeDataset>, InferCreationAttributes<ScopeDataset>> {
  declare id: CreationOptional<string>;
  /** null → SP-global; otherwise a tenant-owned custom entry. */
  declare orgId: string | null;
  declare kind: string;
  declare name: string;
  declare category: string | null;
  declare description: string | null;
  declare status: CreationOptional<string>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
ScopeDataset.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: true, field: "org_id" },
    kind: { type: DataTypes.STRING, allowNull: false },
    name: { type: DataTypes.STRING, allowNull: false },
    category: { type: DataTypes.STRING, allowNull: true },
    description: { type: DataTypes.TEXT, allowNull: true },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Active" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "scope_datasets", underscored: true },
);
