import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { sequelize } from "../sequelize";

export type FrameworkAssignmentStatus = "Planned" | "Active" | "Suspended" | "Archived";

export const FRAMEWORK_ASSIGNMENT_STATUSES: FrameworkAssignmentStatus[] = [
  "Planned",
  "Active",
  "Suspended",
  "Archived",
];

/**
 * A framework assignment records that a tenant has rolled out a given AXIA
 * framework at one of its sites. `orgId` is the tenant organization; `siteId` is
 * the site the framework applies to; `frameworkId` references the global master
 * framework. Each (site, framework) pair is unique. `code` is an `FA-####`
 * business key. Managed by the Service Owner from the tenant Frameworks tab;
 * tenants see their own assignments read-only.
 */
export class FrameworkAssignment extends Model<
  InferAttributes<FrameworkAssignment>,
  InferCreationAttributes<FrameworkAssignment>
> {
  declare id: CreationOptional<string>;
  declare code: string;
  declare orgId: string;
  declare siteId: string;
  declare frameworkId: string;
  declare status: CreationOptional<FrameworkAssignmentStatus>;
  declare assignedDate: CreationOptional<string | null>;
  declare notes: CreationOptional<string | null>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

FrameworkAssignment.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    code: { type: DataTypes.STRING, allowNull: false, unique: true },
    orgId: { type: DataTypes.UUID, allowNull: false, field: "org_id" },
    siteId: { type: DataTypes.UUID, allowNull: false, field: "site_id" },
    frameworkId: { type: DataTypes.UUID, allowNull: false, field: "framework_id" },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Planned" },
    assignedDate: { type: DataTypes.DATEONLY, allowNull: true, field: "assigned_date" },
    notes: { type: DataTypes.TEXT, allowNull: true },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "framework_assignments", underscored: true },
);
