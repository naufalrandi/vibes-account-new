import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { sequelize } from "../sequelize";

export type FrameworkAssignmentStatus = "Planned" | "Active" | "Suspended" | "Archived";

/** Pairs a tenant site with a catalog framework (the tenant's framework rollout). */
export class FrameworkAssignment extends Model<
  InferAttributes<FrameworkAssignment>,
  InferCreationAttributes<FrameworkAssignment>
> {
  declare id: CreationOptional<string>;
  declare orgId: string;
  declare code: string;
  declare siteId: string;
  declare frameworkId: string;
  declare status: CreationOptional<FrameworkAssignmentStatus>;
  declare assignedDate: string | null;
  declare notes: string | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

FrameworkAssignment.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: false, field: "org_id" },
    code: { type: DataTypes.STRING, allowNull: false, unique: true },
    siteId: { type: DataTypes.UUID, allowNull: false, field: "site_id" },
    frameworkId: { type: DataTypes.UUID, allowNull: false, field: "framework_id" },
    status: { type: DataTypes.ENUM("Planned", "Active", "Suspended", "Archived"), allowNull: false, defaultValue: "Planned" },
    assignedDate: { type: DataTypes.DATEONLY, allowNull: true, field: "assigned_date" },
    notes: { type: DataTypes.TEXT, allowNull: true },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "framework_assignments", underscored: true },
);
