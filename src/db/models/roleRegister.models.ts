import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { sequelize } from "../sequelize";

/**
 * Tenant organizational-role template (ISO 5.3). Distinct from IAM roles: this is
 * the responsibilities/authorities catalog assigned to team members. Mirrors the
 * OD prototype's `renderTnRoles` (role templates + assignments with a Modified state).
 */
export class RoleTemplate extends Model<
  InferAttributes<RoleTemplate>,
  InferCreationAttributes<RoleTemplate>
> {
  declare id: CreationOptional<string>;
  declare orgId: string;
  declare code: string;
  declare name: string;
  declare category: string;
  declare purpose: string | null;
  declare workUnits: CreationOptional<string[]>;
  declare processes: CreationOptional<string[]>;
  declare frameworks: CreationOptional<string[]>;
  declare responsibilities: CreationOptional<string[]>;
  declare authorities: CreationOptional<string[]>;
  declare status: string;
  declare notes: string | null;
  declare createdBy: string | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

RoleTemplate.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: false, field: "org_id" },
    code: { type: DataTypes.STRING, allowNull: false },
    name: { type: DataTypes.STRING, allowNull: false },
    category: { type: DataTypes.STRING, allowNull: false, defaultValue: "Other" },
    purpose: { type: DataTypes.TEXT, allowNull: true },
    workUnits: { type: DataTypes.JSONB, allowNull: false, defaultValue: [], field: "work_units" },
    processes: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    frameworks: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    responsibilities: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    authorities: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Draft" },
    notes: { type: DataTypes.TEXT, allowNull: true },
    createdBy: { type: DataTypes.STRING, allowNull: true, field: "created_by" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "role_templates", underscored: true },
);

/**
 * A role template assigned to a team member. `modified` is true when the member's
 * responsibilities/authorities diverge from the template (OD's `rtDiff`), captured
 * with a reason + summary for the audit trail.
 */
export class RoleAssignment extends Model<
  InferAttributes<RoleAssignment>,
  InferCreationAttributes<RoleAssignment>
> {
  declare id: CreationOptional<string>;
  declare orgId: string;
  declare code: string;
  declare memberId: string;
  declare memberName: string;
  declare roleId: string;
  declare roleName: string;
  declare workUnit: string | null;
  declare effectiveDate: string | null;
  declare responsibilities: CreationOptional<string[]>;
  declare authorities: CreationOptional<string[]>;
  declare modified: CreationOptional<boolean>;
  declare modReason: string | null;
  declare modSummary: string | null;
  declare modifiedBy: string | null;
  declare modifiedDate: string | null;
  declare status: string;
  declare notes: string | null;
  declare createdBy: string | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

RoleAssignment.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: false, field: "org_id" },
    code: { type: DataTypes.STRING, allowNull: false },
    memberId: { type: DataTypes.STRING, allowNull: false, field: "member_id" },
    memberName: { type: DataTypes.STRING, allowNull: false, field: "member_name" },
    roleId: { type: DataTypes.UUID, allowNull: false, field: "role_id" },
    roleName: { type: DataTypes.STRING, allowNull: false, field: "role_name" },
    workUnit: { type: DataTypes.STRING, allowNull: true, field: "work_unit" },
    effectiveDate: { type: DataTypes.STRING, allowNull: true, field: "effective_date" },
    responsibilities: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    authorities: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    modified: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    modReason: { type: DataTypes.TEXT, allowNull: true, field: "mod_reason" },
    modSummary: { type: DataTypes.TEXT, allowNull: true, field: "mod_summary" },
    modifiedBy: { type: DataTypes.STRING, allowNull: true, field: "modified_by" },
    modifiedDate: { type: DataTypes.STRING, allowNull: true, field: "modified_date" },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Active" },
    notes: { type: DataTypes.TEXT, allowNull: true },
    createdBy: { type: DataTypes.STRING, allowNull: true, field: "created_by" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "role_assignments", underscored: true },
);
