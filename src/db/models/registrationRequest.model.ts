import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { sequelize } from "../sequelize";

/** OD `TREQ_STATUSES`. `PendingApproval` is the pre-lifecycle value, kept for old rows. */
export type RegistrationStatus =
  | "Draft" | "Submitted" | "Under Review" | "PendingApproval" | "Approved" | "Rejected" | "Cancelled";

export class RegistrationRequest extends Model<
  InferAttributes<RegistrationRequest>,
  InferCreationAttributes<RegistrationRequest>
> {
  declare id: CreationOptional<string>;
  declare distributorOrgId: string;
  declare proposedTenant: Record<string, unknown>;
  declare status: RegistrationStatus;
  /** Org that raised the request — a partner, or the Service Owner for a Direct request. */
  declare submittedBy: string | null;
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
      type: DataTypes.ENUM("Draft", "Submitted", "Under Review", "PendingApproval", "Approved", "Rejected", "Cancelled"),
      allowNull: false,
      defaultValue: "PendingApproval",
    },
    submittedBy: { type: DataTypes.UUID, allowNull: true, field: "submitted_by" },
    decisionReason: { type: DataTypes.STRING, allowNull: true, field: "decision_reason" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "registration_requests", underscored: true },
);
