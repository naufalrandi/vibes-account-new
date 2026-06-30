import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * Phase 4 — Tenants, Sites, Site Requests & Framework Assignments.
 *
 * Per decision R2 a Tenant is a `Tenant` organization + a 1:1 `tenant_profiles`
 * extension (acquisition channel, assigned partner, lifecycle status, audit). The
 * tenant identity fields (name/legalName/industry/contact…) live on the
 * `organizations` row. Sites are N-per-tenant; site requests drive the
 * controlled change/closure/addition workflow; framework assignments pair a site
 * with a catalog framework.
 *
 * Lifecycle enums use the spaced PRD labels the frontend renders directly.
 */
const SITE_TYPES = [
  "Head Office", "Branch Office", "Factory", "Warehouse",
  "Data Center", "Subsidiary", "Business Unit", "Other",
];

export const up: Migration = async ({ context: q }) => {
  await q.createTable("tenant_profiles", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: {
      type: DataTypes.UUID, allowNull: false, unique: true,
      references: { model: "organizations", key: "id" }, onDelete: "CASCADE",
    },
    acquisition: { type: DataTypes.ENUM("Direct", "Partner"), allowNull: false, defaultValue: "Direct" },
    partner_org_id: { type: DataTypes.UUID, allowNull: true },
    billing_owner: { type: DataTypes.STRING, allowNull: true },
    status: {
      type: DataTypes.ENUM("Draft", "Pending Activation", "Active", "Suspended", "Inactive"),
      allowNull: false, defaultValue: "Draft",
    },
    subscription_summary: { type: DataTypes.JSONB, allowNull: true },
    audit: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });

  await q.createTable("sites", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: {
      type: DataTypes.UUID, allowNull: false,
      references: { model: "organizations", key: "id" }, onDelete: "CASCADE",
    },
    code: { type: DataTypes.STRING, allowNull: false, unique: true },
    name: { type: DataTypes.STRING, allowNull: false },
    type: { type: DataTypes.ENUM(...SITE_TYPES), allowNull: false, defaultValue: "Branch Office" },
    country: { type: DataTypes.STRING, allowNull: true },
    address: { type: DataTypes.STRING, allowNull: true },
    status: { type: DataTypes.ENUM("Active", "Inactive"), allowNull: false, defaultValue: "Active" },
    is_primary: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    description: { type: DataTypes.TEXT, allowNull: true },
    contact_person: { type: DataTypes.STRING, allowNull: true },
    contact_email: { type: DataTypes.STRING, allowNull: true },
    contact_phone: { type: DataTypes.STRING, allowNull: true },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
  await q.addIndex("sites", ["org_id"]);

  await q.createTable("site_requests", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: {
      type: DataTypes.UUID, allowNull: false,
      references: { model: "organizations", key: "id" }, onDelete: "CASCADE",
    },
    code: { type: DataTypes.STRING, allowNull: false, unique: true },
    type: { type: DataTypes.ENUM("Site Addition", "Site Change", "Site Closure"), allowNull: false },
    site_id: { type: DataTypes.UUID, allowNull: true },
    requested_by: { type: DataTypes.STRING, allowNull: false, defaultValue: "Tenant" },
    proposed: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    reason: { type: DataTypes.TEXT, allowNull: true },
    status: {
      type: DataTypes.ENUM("Draft", "Submitted", "Under Review", "Approved", "Rejected", "Cancelled"),
      allowNull: false, defaultValue: "Submitted",
    },
    provisioned: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    provisioned_site_id: { type: DataTypes.UUID, allowNull: true },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
  await q.addIndex("site_requests", ["org_id"]);

  await q.createTable("framework_assignments", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: {
      type: DataTypes.UUID, allowNull: false,
      references: { model: "organizations", key: "id" }, onDelete: "CASCADE",
    },
    code: { type: DataTypes.STRING, allowNull: false, unique: true },
    site_id: {
      type: DataTypes.UUID, allowNull: false,
      references: { model: "sites", key: "id" }, onDelete: "CASCADE",
    },
    framework_id: {
      type: DataTypes.UUID, allowNull: false,
      references: { model: "frameworks", key: "id" }, onDelete: "CASCADE",
    },
    status: {
      type: DataTypes.ENUM("Planned", "Active", "Suspended", "Archived"),
      allowNull: false, defaultValue: "Planned",
    },
    assigned_date: { type: DataTypes.DATEONLY, allowNull: true },
    notes: { type: DataTypes.TEXT, allowNull: true },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
  await q.addIndex("framework_assignments", ["org_id"]);
};

export const down: Migration = async ({ context: q }) => {
  await q.dropTable("framework_assignments");
  await q.dropTable("site_requests");
  await q.dropTable("sites");
  await q.dropTable("tenant_profiles");
};
