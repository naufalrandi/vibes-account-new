import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { sequelize } from "../sequelize";

/**
 * Approval scheme / gate engine (ISO governance sign-off). Built-in schemes
 * (S0/S1/S2) live in code; custom C-series schemes are per-tenant. A per-tenant
 * module→scheme map assigns a scheme to each governed register module. Pool
 * membership (MS Team / Top Management) is per-user flags. An approval record is
 * a frozen snapshot of the scheme + resolved approvers, one per governed entity.
 */
export const AP_POOLS = ["mst", "top"] as const;
export const AP_MST_PRIORITY = ["required", "optional"] as const;
export type ApPool = (typeof AP_POOLS)[number];

/** A gate as stored on a scheme definition. */
export interface SchemeGate { label: string; pool: string; isFinalGate: boolean }
/** A gate at runtime on an approval record (resolved approvers + signatures). */
export interface RuntimeGate { pool: string; label: string; isFinalGate: boolean; required: string[]; eligible: string[]; approvals: { by: string; at: string }[] }

export class ApprovalScheme extends Model<InferAttributes<ApprovalScheme>, InferCreationAttributes<ApprovalScheme>> {
  declare id: CreationOptional<string>;
  declare orgId: string;
  declare code: string;
  declare name: string;
  declare kind: CreationOptional<string>;
  declare selfServe: CreationOptional<boolean>;
  declare description: string | null;
  declare gates: CreationOptional<SchemeGate[]>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
ApprovalScheme.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: false, field: "org_id" },
    code: { type: DataTypes.STRING, allowNull: false },
    name: { type: DataTypes.STRING, allowNull: false },
    kind: { type: DataTypes.STRING, allowNull: false, defaultValue: "custom" },
    selfServe: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: "self_serve" },
    description: { type: DataTypes.TEXT, allowNull: true },
    gates: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "approval_schemes", underscored: true },
);

export class ApprovalModuleMap extends Model<InferAttributes<ApprovalModuleMap>, InferCreationAttributes<ApprovalModuleMap>> {
  declare id: CreationOptional<string>;
  declare orgId: string;
  declare moduleKey: string;
  declare schemeId: string;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
ApprovalModuleMap.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: false, field: "org_id" },
    moduleKey: { type: DataTypes.STRING, allowNull: false, field: "module_key" },
    schemeId: { type: DataTypes.STRING, allowNull: false, field: "scheme_id" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "approval_module_map", underscored: true },
);

export class ApprovalPoolMember extends Model<InferAttributes<ApprovalPoolMember>, InferCreationAttributes<ApprovalPoolMember>> {
  declare id: CreationOptional<string>;
  declare orgId: string;
  declare userId: string;
  declare isMST: CreationOptional<boolean>;
  declare mstPriority: CreationOptional<string>;
  declare isTM: CreationOptional<boolean>;
  declare tmFinal: CreationOptional<boolean>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
ApprovalPoolMember.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: false, field: "org_id" },
    userId: { type: DataTypes.UUID, allowNull: false, field: "user_id" },
    isMST: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: "is_mst" },
    mstPriority: { type: DataTypes.STRING, allowNull: false, defaultValue: "required", field: "mst_priority" },
    isTM: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: "is_tm" },
    tmFinal: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: "tm_final" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "approval_pool_members", underscored: true },
);

export class ApprovalRecord extends Model<InferAttributes<ApprovalRecord>, InferCreationAttributes<ApprovalRecord>> {
  declare id: CreationOptional<string>;
  declare orgId: string;
  declare module: string;
  declare recordId: string;
  declare schemeId: string;
  declare schemeName: string;
  declare selfServe: CreationOptional<boolean>;
  declare gateIdx: CreationOptional<number>;
  declare gates: CreationOptional<RuntimeGate[]>;
  declare authorName: string | null;
  declare state: CreationOptional<string>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
ApprovalRecord.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: false, field: "org_id" },
    module: { type: DataTypes.STRING, allowNull: false },
    recordId: { type: DataTypes.UUID, allowNull: false, field: "record_id" },
    schemeId: { type: DataTypes.STRING, allowNull: false, field: "scheme_id" },
    schemeName: { type: DataTypes.STRING, allowNull: false, field: "scheme_name" },
    selfServe: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: "self_serve" },
    gateIdx: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: "gate_idx" },
    gates: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    authorName: { type: DataTypes.STRING, allowNull: true, field: "author_name" },
    state: { type: DataTypes.STRING, allowNull: false, defaultValue: "active" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "approval_records", underscored: true },
);

export class ApprovalSettings extends Model<InferAttributes<ApprovalSettings>, InferCreationAttributes<ApprovalSettings>> {
  declare id: CreationOptional<string>;
  declare orgId: string;
  declare selfApprovalAllowed: CreationOptional<boolean>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
ApprovalSettings.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: false, unique: true, field: "org_id" },
    selfApprovalAllowed: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: "self_approval_allowed" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "approval_settings", underscored: true },
);
