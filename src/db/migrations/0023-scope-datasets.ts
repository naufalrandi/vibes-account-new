import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * Scope master datasets (SP-owned pick-lists for the scope dimensions): virtual
 * environments, personnel types, and external-dependency categories. The SP-
 * global (org_id NULL) rows are seeded lazily/idempotently by the service
 * (survives the test harness's CASCADE truncation and needs no separate seeder).
 */
export const up: Migration = async ({ context: q }) => {
  await q.createTable("scope_datasets", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: { type: DataTypes.UUID, allowNull: true, references: { model: "organizations", key: "id" }, onDelete: "CASCADE" },
    kind: { type: DataTypes.STRING, allowNull: false },
    name: { type: DataTypes.STRING, allowNull: false },
    category: { type: DataTypes.STRING, allowNull: true },
    description: { type: DataTypes.TEXT, allowNull: true },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Active" },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
  await q.addIndex("scope_datasets", ["kind"]);
  await q.addIndex("scope_datasets", ["org_id"]);
};

export const down: Migration = async ({ context: q }) => {
  await q.dropTable("scope_datasets");
};
