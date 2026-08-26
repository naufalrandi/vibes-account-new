import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { sequelize } from "../sequelize";

/**
 * Tenant Business Process register (ISO 4.4). Rows are either materialised from
 * the master catalog (`sourceType: "Catalog"`, matched per org by `catalogKey`
 * via `wuEnsureBps`-style merge) or added directly by the tenant
 * (`sourceType: "Tenant Created"`). Mirrors the OD prototype's `renderBizProc`.
 */
export class BusinessProcess extends Model<
  InferAttributes<BusinessProcess>,
  InferCreationAttributes<BusinessProcess>
> {
  declare id: CreationOptional<string>;
  declare orgId: string;
  declare code: string;
  declare catalogKey: string | null;
  declare name: string;
  declare group: string | null;
  declare subgroup: string | null;
  declare description: string | null;
  declare status: string;
  declare sourceType: string;
  declare createdBy: string | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

BusinessProcess.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: false, field: "org_id" },
    code: { type: DataTypes.STRING, allowNull: false },
    catalogKey: { type: DataTypes.STRING, allowNull: true, field: "catalog_key" },
    name: { type: DataTypes.STRING, allowNull: false },
    group: { type: DataTypes.STRING, allowNull: true },
    subgroup: { type: DataTypes.STRING, allowNull: true },
    description: { type: DataTypes.TEXT, allowNull: true },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Active" },
    sourceType: { type: DataTypes.STRING, allowNull: false, defaultValue: "Tenant Created", field: "source_type" },
    createdBy: { type: DataTypes.STRING, allowNull: true, field: "created_by" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "business_processes", underscored: true }
);

/** A process step — responsible person, resources, KPI target, role & work unit, plus outgoing flow edges (`next`). */
export class BusinessProcessStep extends Model<
  InferAttributes<BusinessProcessStep>,
  InferCreationAttributes<BusinessProcessStep>
> {
  declare id: CreationOptional<string>;
  declare orgId: string;
  declare processId: string;
  declare seq: number;
  declare name: string;
  declare description: string | null;
  declare responsible: string | null;
  declare resources: string | null;
  declare kpi: string | null;
  declare roleId: string | null;
  declare workUnitId: string | null;
  declare next: CreationOptional<string[]>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

BusinessProcessStep.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: false, field: "org_id" },
    processId: { type: DataTypes.UUID, allowNull: false, field: "process_id" },
    seq: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    name: { type: DataTypes.STRING, allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: true },
    responsible: { type: DataTypes.STRING, allowNull: true },
    resources: { type: DataTypes.TEXT, allowNull: true },
    kpi: { type: DataTypes.TEXT, allowNull: true },
    roleId: { type: DataTypes.UUID, allowNull: true, field: "role_id" },
    workUnitId: { type: DataTypes.UUID, allowNull: true, field: "work_unit_id" },
    next: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "business_process_steps", underscored: true }
);
