import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

export const up: Migration = async ({ context: q }) => {
  await q.createTable("saas_pipeline", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    code: { type: DataTypes.STRING(32), allowNull: false },
    tenant_id: { type: DataTypes.UUID, allowNull: true },
    tenant_name: { type: DataTypes.STRING(255), allowNull: false },
    partner_id: { type: DataTypes.UUID, allowNull: true },
    industry: { type: DataTypes.STRING(128), allowNull: true },
    country: { type: DataTypes.STRING(16), allowNull: false, defaultValue: "ID" },
    contact_person: { type: DataTypes.STRING(255), allowNull: true },
    contact_email: { type: DataTypes.STRING(255), allowNull: true },
    contact_phone: { type: DataTypes.STRING(64), allowNull: true },
    type: { type: DataTypes.STRING(64), allowNull: false, defaultValue: "New Tenant / SaaS" },
    stage: { type: DataTypes.STRING(64), allowNull: false, defaultValue: "Quote Sent" },
    items: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    amount: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
    currency: { type: DataTypes.STRING(16), allowNull: false, defaultValue: "IDR" },
    registration_complete: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    registration: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    payment: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    sub_id: { type: DataTypes.STRING(64), allowNull: true },
    audit: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });

  await q.addIndex("saas_pipeline", ["code"], { unique: true, name: "saas_pipeline_code_unique" });
  await q.addIndex("saas_pipeline", ["stage"], { name: "saas_pipeline_stage_idx" });

  await q.createTable("saas_subscriptions", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    code: { type: DataTypes.STRING(32), allowNull: false },
    tenant_id: { type: DataTypes.UUID, allowNull: false },
    pipeline_id: { type: DataTypes.UUID, allowNull: true },
    partner_id: { type: DataTypes.UUID, allowNull: true },
    products: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    start_date: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    renewal_date: { type: DataTypes.DATE, allowNull: true },
    last_payment_at: { type: DataTypes.DATE, allowNull: true },
    amount: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
    currency: { type: DataTypes.STRING(16), allowNull: false, defaultValue: "IDR" },
    payment_method: { type: DataTypes.STRING(64), allowNull: false, defaultValue: "Bank Transfer" },
    cc_adequate_limit: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    auto_renew: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    term: { type: DataTypes.STRING(32), allowNull: false, defaultValue: "12 months" },
    status: { type: DataTypes.STRING(32), allowNull: false, defaultValue: "Active" },
    grace_started_at: { type: DataTypes.DATE, allowNull: true },
    archived_at: { type: DataTypes.DATE, allowNull: true },
    audit: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });

  await q.addIndex("saas_subscriptions", ["code"], { unique: true, name: "saas_subscriptions_code_unique" });
  await q.addIndex("saas_subscriptions", ["tenant_id"], { name: "saas_subscriptions_tenant_idx" });

  await q.createTable("saas_workspaces", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    code: { type: DataTypes.STRING(32), allowNull: false },
    tenant_id: { type: DataTypes.UUID, allowNull: false },
    sub_id: { type: DataTypes.UUID, allowNull: false },
    product: { type: DataTypes.STRING(64), allowNull: false },
    name: { type: DataTypes.STRING(255), allowNull: false },
    standard: { type: DataTypes.STRING(128), allowNull: true },
    status: { type: DataTypes.STRING(32), allowNull: false, defaultValue: "Active" },
    provisioned_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    audit: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });

  await q.addIndex("saas_workspaces", ["code"], { unique: true, name: "saas_workspaces_code_unique" });
  await q.addIndex("saas_workspaces", ["tenant_id"], { name: "saas_workspaces_tenant_idx" });
  await q.addIndex("saas_workspaces", ["sub_id"], { name: "saas_workspaces_sub_idx" });
};

export const down: Migration = async ({ context: q }) => {
  await q.dropTable("saas_workspaces");
  await q.dropTable("saas_subscriptions");
  await q.dropTable("saas_pipeline");
};
