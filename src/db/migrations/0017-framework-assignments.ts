import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * Phase 4 (Tenant Operations) — the `framework_assignments` table: which AXIA
 * frameworks a tenant has rolled out at each of its sites. `code` is a unique
 * `FA-####` business key. A framework is assigned to exactly one (tenant, site)
 * pair at a time, enforced by a unique index on (site_id, framework_id). Deleting
 * the tenant org or site cascades its assignments; the framework master row is
 * kept (RESTRICT). `status` is STRING (mutable AXIA labels: Planned/Active/
 * Suspended/Archived) to avoid Postgres enum-migration churn.
 */
export const up: Migration = async ({ context: q }) => {
  await q.createTable("framework_assignments", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    code: { type: DataTypes.STRING, allowNull: false, unique: true },
    org_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "organizations", key: "id" },
      onDelete: "CASCADE",
    },
    site_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "sites", key: "id" },
      onDelete: "CASCADE",
    },
    framework_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "frameworks", key: "id" },
      onDelete: "RESTRICT",
    },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Planned" },
    assigned_date: { type: DataTypes.DATEONLY, allowNull: true },
    notes: { type: DataTypes.TEXT, allowNull: true },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
  await q.addIndex("framework_assignments", ["org_id"]);
  await q.addIndex("framework_assignments", ["site_id", "framework_id"], {
    unique: true,
    name: "framework_assignments_site_framework_unique",
  });
};

export const down: Migration = async ({ context: q }) => {
  await q.dropTable("framework_assignments");
};
