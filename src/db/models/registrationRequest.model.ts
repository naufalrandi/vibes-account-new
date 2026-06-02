import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { sequelize } from "../sequelize";

export class RegistrationRequest extends Model<
  InferAttributes<RegistrationRequest>,
  InferCreationAttributes<RegistrationRequest>
> {
  declare id: CreationOptional<string>;
  declare distributorOrgId: string;
  declare proposedTenant: Record<string, unknown>;
  declare status: "PendingApproval" | "Approved" | "Rejected";
  declare decisionReason: string | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

RegistrationRequest.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    distributorOrgId: { type: DataTypes.UUID, allowNull: false, field: "distributor_org_id" },
    proposedTenant: { type: DataTypes.JSONB, allowNull: false, field: "proposed_tenant" },
    status: {
      type: DataTypes.ENUM("PendingApproval", "Approved", "Rejected"),
      allowNull: false,
      defaultValue: "PendingApproval",
    },
    decisionReason: { type: DataTypes.STRING, allowNull: true, field: "decision_reason" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "registration_requests", underscored: true },
);
