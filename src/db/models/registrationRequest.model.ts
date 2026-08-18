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
  /** OD "TRQ-####" request code (0046) — distinct from the proposed org's own code. */
  declare code: string;
  /** Null represents OD's "Direct (Service Provider acquisition)" — no partner (0046). */
  declare distributorOrgId: string | null;
  declare proposedTenant: Record<string, unknown>;
  declare status: RegistrationStatus;
  /** Org that raised the request — a partner, or the Service Owner for a Direct request. */
  declare submittedBy: string | null;
  declare decisionReason: string | null;
  /** Set once the request is provisioned into a tenant org (OD `rq.tenantId`, 0046). */
  declare tenantId: string | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

RegistrationRequest.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    code: { type: DataTypes.STRING, allowNull: false },
    distributorOrgId: { type: DataTypes.UUID, allowNull: true, field: "distributor_org_id" },
    proposedTenant: { type: DataTypes.JSONB, allowNull: false, field: "proposed_tenant" },
    status: {
      type: DataTypes.ENUM("Draft", "Submitted", "Under Review", "PendingApproval", "Approved", "Rejected", "Cancelled"),
      allowNull: false,
      defaultValue: "PendingApproval",
    },
    submittedBy: { type: DataTypes.UUID, allowNull: true, field: "submitted_by" },
    decisionReason: { type: DataTypes.STRING, allowNull: true, field: "decision_reason" },
    tenantId: { type: DataTypes.UUID, allowNull: true, field: "tenant_id" },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "registration_requests", underscored: true },
);
