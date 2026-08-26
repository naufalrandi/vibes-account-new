import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { sequelize } from "../sequelize";

/**
 * SaaS lifecycle layer (G-73/G-75; migration 0072-saas-lifecycle.ts).
 * Mirrors OD app.html:5950-6020 1:1 — see that file's comment block for the
 * entity relationships: Tenant has many Workspaces (one per SaaS product:
 * ms/lab/cab/personnel); a Subscription is a bundle of workspaces billed and
 * renewed together; a Pipeline record tracks quote -> registration ->
 * payment(verify) -> auto-provision. Payment (bank transfer, manually
 * verified) is the only gate. Grace is per-Subscription and cascades to every
 * workspace in the bundle — see src/modules/saas/lifecycle.service.ts for the
 * date-driven state resolver (SAAS_SUB_STATES / SAAS_WS_STATES).
 */

export interface SaasAuditEntry {
  ts: string;
  msg: string;
}

// ---- Pipeline (quote -> registration -> payment -> provisioning) ----------

export type SaasPipelineStage =
  | "Quote Sent"
  | "Accepted"
  | "Registration"
  | "Awaiting Transfer"
  | "Under Verification"
  | "Verified"
  | "Provisioning"
  | "Completed"
  | "Provisioning Failed"
  | "Declined";

/**
 * OD's Request Type select (`pq-type`, js/core.js:7395) offers exactly these
 * two values, and `reqRows` (js/core.js:7418) falls back to the first one for
 * rows that carry no type. Column stays STRING(64) — this is the accepted
 * input set, not a DB enum.
 */
export const SAAS_PIPELINE_TYPES = ["New Tenant / SaaS", "Add-on: SaaS"] as const;
export type SaasPipelineType = (typeof SAAS_PIPELINE_TYPES)[number];

export class SaasPipeline extends Model<InferAttributes<SaasPipeline>, InferCreationAttributes<SaasPipeline>> {
  declare id: CreationOptional<string>;
  declare code: string;
  declare tenantId: string | null;
  declare tenantName: string;
  declare partnerId: string | null;
  declare industry: string | null;
  declare country: CreationOptional<string>;
  declare contactPerson: string | null;
  declare contactEmail: string | null;
  declare contactPhone: string | null;
  declare type: CreationOptional<SaasPipelineType>;
  declare stage: CreationOptional<SaasPipelineStage>;
  declare items: CreationOptional<unknown[]>;
  declare amount: CreationOptional<number>;
  declare currency: CreationOptional<string>;
  declare registrationComplete: CreationOptional<boolean>;
  declare registration: CreationOptional<Record<string, unknown>>;
  declare payment: CreationOptional<Record<string, unknown>>;
  declare subId: string | null;
  declare audit: CreationOptional<SaasAuditEntry[]>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

SaasPipeline.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    code: { type: DataTypes.STRING(32), allowNull: false, unique: true },
    tenantId: { type: DataTypes.UUID, allowNull: true, field: "tenant_id" },
    tenantName: { type: DataTypes.STRING(255), allowNull: false, field: "tenant_name" },
    partnerId: { type: DataTypes.UUID, allowNull: true, field: "partner_id" },
    industry: { type: DataTypes.STRING(128), allowNull: true },
    country: { type: DataTypes.STRING(16), allowNull: false, defaultValue: "ID" },
    contactPerson: { type: DataTypes.STRING(255), allowNull: true, field: "contact_person" },
    contactEmail: { type: DataTypes.STRING(255), allowNull: true, field: "contact_email" },
    contactPhone: { type: DataTypes.STRING(64), allowNull: true, field: "contact_phone" },
    type: { type: DataTypes.STRING(64), allowNull: false, defaultValue: "New Tenant / SaaS" },
    stage: { type: DataTypes.STRING(64), allowNull: false, defaultValue: "Quote Sent" },
    items: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    amount: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
    currency: { type: DataTypes.STRING(16), allowNull: false, defaultValue: "IDR" },
    registrationComplete: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: "registration_complete" },
    registration: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    payment: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    subId: { type: DataTypes.STRING(64), allowNull: true, field: "sub_id" },
    audit: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    createdAt: { type: DataTypes.DATE, field: "created_at" },
    updatedAt: { type: DataTypes.DATE, field: "updated_at" },
  },
  { sequelize, tableName: "saas_pipeline", underscored: true },
);

// ---- Subscription (billing bundle of workspaces) ---------------------------

export type SaasSubStatus = "Active" | "Provisioning" | "Purged";
export type SaasPaymentMethod = "Bank Transfer" | "Credit Card";

export class SaasSubscription extends Model<InferAttributes<SaasSubscription>, InferCreationAttributes<SaasSubscription>> {
  declare id: CreationOptional<string>;
  declare code: string;
  declare tenantId: string;
  declare pipelineId: string | null;
  declare partnerId: string | null;
  declare products: CreationOptional<string[]>;
  declare startDate: CreationOptional<Date>;
  declare renewalDate: Date | null;
  declare lastPaymentAt: Date | null;
  declare amount: CreationOptional<number>;
  declare currency: CreationOptional<string>;
  declare paymentMethod: CreationOptional<SaasPaymentMethod>;
  declare ccAdequateLimit: CreationOptional<boolean>;
  declare autoRenew: CreationOptional<boolean>;
  declare term: CreationOptional<string>;
  // Raw persisted status. Only 'Provisioning'/'Purged' are read as terminal
  // overrides by the resolver — otherwise state is date-driven off renewalDate
  // (see lifecycle.service.ts resolveSaasSubState, 1:1 with OD's saasSubState).
  declare status: CreationOptional<string>;
  declare graceStartedAt: Date | null;
  declare archivedAt: Date | null;
  declare audit: CreationOptional<SaasAuditEntry[]>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

SaasSubscription.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    code: { type: DataTypes.STRING(32), allowNull: false, unique: true },
    tenantId: { type: DataTypes.UUID, allowNull: false, field: "tenant_id" },
    pipelineId: { type: DataTypes.UUID, allowNull: true, field: "pipeline_id" },
    partnerId: { type: DataTypes.UUID, allowNull: true, field: "partner_id" },
    products: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    startDate: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: "start_date" },
    renewalDate: { type: DataTypes.DATE, allowNull: true, field: "renewal_date" },
    lastPaymentAt: { type: DataTypes.DATE, allowNull: true, field: "last_payment_at" },
    amount: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
    currency: { type: DataTypes.STRING(16), allowNull: false, defaultValue: "IDR" },
    paymentMethod: { type: DataTypes.STRING(64), allowNull: false, defaultValue: "Bank Transfer", field: "payment_method" },
    ccAdequateLimit: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: "cc_adequate_limit" },
    autoRenew: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: "auto_renew" },
    term: { type: DataTypes.STRING(32), allowNull: false, defaultValue: "12 months" },
    status: { type: DataTypes.STRING(32), allowNull: false, defaultValue: "Active" },
    graceStartedAt: { type: DataTypes.DATE, allowNull: true, field: "grace_started_at" },
    archivedAt: { type: DataTypes.DATE, allowNull: true, field: "archived_at" },
    audit: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    createdAt: { type: DataTypes.DATE, field: "created_at" },
    updatedAt: { type: DataTypes.DATE, field: "updated_at" },
  },
  { sequelize, tableName: "saas_subscriptions", underscored: true },
);

// ---- Workspace (one SaaS product instance for a tenant) --------------------

export type SaasWsStatus = "Provisioning" | "Active" | "Failed";

export class SaasWorkspace extends Model<InferAttributes<SaasWorkspace>, InferCreationAttributes<SaasWorkspace>> {
  declare id: CreationOptional<string>;
  declare code: string;
  declare tenantId: string;
  declare subId: string;
  declare product: string;
  declare name: string;
  declare standard: string | null;
  // Raw persisted status. 'Provisioning'/'Failed' are local overrides read by
  // the resolver; otherwise effective state cascades from the subscription
  // (see lifecycle.service.ts resolveSaasWsState, 1:1 with OD's saasWsState).
  declare status: CreationOptional<string>;
  declare provisionedAt: CreationOptional<Date>;
  declare audit: CreationOptional<SaasAuditEntry[]>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

SaasWorkspace.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    code: { type: DataTypes.STRING(32), allowNull: false, unique: true },
    tenantId: { type: DataTypes.UUID, allowNull: false, field: "tenant_id" },
    subId: { type: DataTypes.UUID, allowNull: false, field: "sub_id" },
    product: { type: DataTypes.STRING(64), allowNull: false },
    name: { type: DataTypes.STRING(255), allowNull: false },
    standard: { type: DataTypes.STRING(128), allowNull: true },
    status: { type: DataTypes.STRING(32), allowNull: false, defaultValue: "Active" },
    provisionedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: "provisioned_at" },
    audit: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    createdAt: { type: DataTypes.DATE, field: "created_at" },
    updatedAt: { type: DataTypes.DATE, field: "updated_at" },
  },
  { sequelize, tableName: "saas_workspaces", underscored: true },
);
