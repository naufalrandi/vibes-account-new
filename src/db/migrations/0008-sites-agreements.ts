import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * Adds the Tenant-site domain and the partnership-agreement template catalog:
 *   - `sites`: a tenant org's physical/operational locations (one primary each).
 *   - `site_requests`: tenant/partner-initiated site add/change/closure requests
 *     reviewed and provisioned by the Service Owner.
 *   - `agreement_templates`: reusable, versioned partnership agreement documents.
 * Sites and site requests are scoped to a tenant organization (org_id);
 * agreement templates are platform-global master data.
 */
export const up: Migration = async ({ context: q }) => {
  const uuid = { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true };
  const ts = {
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  };

  await q.createTable("sites", {
    id: uuid,
    org_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "organizations", key: "id" },
      onDelete: "CASCADE",
    },
    code: { type: DataTypes.STRING, allowNull: false, unique: true },
    name: { type: DataTypes.STRING, allowNull: false },
    type: {
      type: DataTypes.ENUM(
        "Head Office",
        "Branch Office",
        "Factory",
        "Warehouse",
        "Data Center",
        "Subsidiary",
        "Business Unit",
        "Other",
      ),
      allowNull: false,
      defaultValue: "Branch Office",
    },
    country: { type: DataTypes.STRING, allowNull: true },
    address: { type: DataTypes.TEXT, allowNull: true },
    status: { type: DataTypes.ENUM("Active", "Inactive"), allowNull: false, defaultValue: "Active" },
    is_primary: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    description: { type: DataTypes.TEXT, allowNull: true },
    contact_person: { type: DataTypes.STRING, allowNull: true },
    contact_email: { type: DataTypes.STRING, allowNull: true },
    contact_phone: { type: DataTypes.STRING, allowNull: true },
    ...ts,
  });
  await q.addIndex("sites", ["org_id"]);

  await q.createTable("site_requests", {
    id: uuid,
    org_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "organizations", key: "id" },
      onDelete: "CASCADE",
    },
    code: { type: DataTypes.STRING, allowNull: false, unique: true },
    type: { type: DataTypes.ENUM("Site Addition", "Site Change", "Site Closure"), allowNull: false },
    site_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: "sites", key: "id" },
      onDelete: "SET NULL",
    },
    requested_by: { type: DataTypes.STRING, allowNull: false, defaultValue: "ServiceOwner" },
    proposed: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    reason: { type: DataTypes.TEXT, allowNull: true },
    status: {
      type: DataTypes.ENUM("Draft", "Submitted", "Under Review", "Approved", "Rejected", "Cancelled"),
      allowNull: false,
      defaultValue: "Submitted",
    },
    provisioned: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    provisioned_site_id: { type: DataTypes.UUID, allowNull: true },
    ...ts,
  });
  await q.addIndex("site_requests", ["org_id"]);
  await q.addIndex("site_requests", ["status"]);

  await q.createTable("agreement_templates", {
    id: uuid,
    code: { type: DataTypes.STRING, allowNull: false, unique: true },
    name: { type: DataTypes.STRING, allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: true },
    version: { type: DataTypes.STRING, allowNull: false, defaultValue: "v1.0" },
    status: { type: DataTypes.ENUM("Draft", "Active", "Archived"), allowNull: false, defaultValue: "Draft" },
    blocks: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    ...ts,
  });
};

export const down: Migration = async ({ context: q }) => {
  await q.dropTable("agreement_templates");
  await q.dropTable("site_requests");
  await q.dropTable("sites");
};
