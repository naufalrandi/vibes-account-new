import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * Demo Access — time-boxed, isolated demo workspaces managed by the Service
 * Provider. Requests originate on the public landing page; the SP approves,
 * generates (seeds + issues credentials), extends, disables, or deletes them.
 * Access auto-expires and is archived after a retention window.
 */
export const up: Migration = async ({ context: q }) => {
  await q.createTable("demo_tenants", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    code: { type: DataTypes.STRING, allowNull: false, unique: true },
    org: { type: DataTypes.STRING, allowNull: false },
    name: { type: DataTypes.STRING, allowNull: false },
    email: { type: DataTypes.STRING, allowNull: false },
    title: { type: DataTypes.STRING, allowNull: true },
    country: { type: DataTypes.STRING, allowNull: true },
    module: { type: DataTypes.STRING, allowNull: false },
    modules: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    intended_use: { type: DataTypes.TEXT, allowNull: true },
    tenant_id: { type: DataTypes.STRING, allowNull: false },
    user_id: { type: DataTypes.STRING, allowNull: false },
    username: { type: DataTypes.STRING, allowNull: false },
    temp_password: { type: DataTypes.STRING, allowNull: false },
    role: { type: DataTypes.STRING, allowNull: false, defaultValue: "Demo Tenant Admin" },
    approval: { type: DataTypes.ENUM("Pending", "Approved", "Rejected"), allowNull: false, defaultValue: "Pending" },
    access_status: { type: DataTypes.ENUM("Active", "Expired", "Disabled", "Deleted", "Archived"), allowNull: true },
    seed_status: { type: DataTypes.ENUM("Pending", "Seeded"), allowNull: false, defaultValue: "Pending" },
    validity_hours: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 48 },
    expires_at: { type: DataTypes.DATE, allowNull: true },
    last_login: { type: DataTypes.DATE, allowNull: true },
    deleted_at: { type: DataTypes.DATE, allowNull: true },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
  await q.addIndex("demo_tenants", ["approval"]);
  await q.addIndex("demo_tenants", ["access_status"]);
};

export const down: Migration = async ({ context: q }) => {
  await q.dropTable("demo_tenants");
};
