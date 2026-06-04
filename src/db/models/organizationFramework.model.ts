import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { sequelize } from "../sequelize";

/**
 * A subscription linking an organization to a framework from the master catalog.
 * The (org_id, framework_id) pair is unique — an organization may subscribe to a
 * given framework only once. Distinct from the plan-level `subscriptions` table,
 * which carries entitlements rather than catalog selections.
 */
export class OrganizationFramework extends Model<
  InferAttributes<OrganizationFramework>,
  InferCreationAttributes<OrganizationFramework>
> {
  declare id: CreationOptional<string>;
  declare orgId: string;
  declare frameworkId: string;
  declare subscribedByUserId: string | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

OrganizationFramework.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: false, field: "org_id" },
    frameworkId: { type: DataTypes.UUID, allowNull: false, field: "framework_id" },
    subscribedByUserId: { type: DataTypes.UUID, allowNull: true, field: "subscribed_by_user_id" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  {
    sequelize,
    tableName: "organization_frameworks",
    underscored: true,
    indexes: [{ unique: true, fields: ["org_id", "framework_id"] }],
  },
);
