import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { sequelize } from "../sequelize";

export class AuditLog extends Model<InferAttributes<AuditLog>, InferCreationAttributes<AuditLog>> {
  declare id: CreationOptional<string>;
  declare at: CreationOptional<Date>;
  declare actorUserId: string | null;
  declare organizationId: string | null;
  declare tenantId: string | null;
  declare action: string;
  declare entityType: string;
  declare entityId: string | null;
  declare sourceIp: string | null;
  declare result: "Success" | "Failure";
  declare metadata: Record<string, unknown> | null;
}

AuditLog.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    actorUserId: { type: DataTypes.UUID, allowNull: true, field: "actor_user_id" },
    organizationId: { type: DataTypes.UUID, allowNull: true, field: "organization_id" },
    tenantId: { type: DataTypes.UUID, allowNull: true, field: "tenant_id" },
    action: { type: DataTypes.STRING, allowNull: false },
    entityType: { type: DataTypes.STRING, allowNull: false, field: "entity_type" },
    entityId: { type: DataTypes.UUID, allowNull: true, field: "entity_id" },
    sourceIp: { type: DataTypes.STRING, allowNull: true, field: "source_ip" },
    result: { type: DataTypes.ENUM("Success", "Failure"), allowNull: false },
    metadata: { type: DataTypes.JSONB, allowNull: true },
  },
  { sequelize, tableName: "audit_logs", underscored: true, timestamps: false },
);
