import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * Closes the demo-tenant login gap: `demo_tenants.tenant_id`/`user_id` were
 * always synthetic display strings (`DEMO-xxx`/`DU-xxx`) with no real
 * Organization/User behind them, so a demo tenant could never authenticate
 * through the real `/v1/auth/login`. These two nullable FKs point at the real
 * rows `generateDemoTenant()` now provisions — `tenant_id`/`user_id` keep
 * their existing meaning (display codes) unchanged.
 */
export const up: Migration = async ({ context: q }) => {
  await q.addColumn("demo_tenants", "provisioned_org_id", {
    type: DataTypes.UUID, allowNull: true, references: { model: "organizations", key: "id" }, onDelete: "SET NULL",
  });
  await q.addColumn("demo_tenants", "provisioned_user_id", {
    type: DataTypes.UUID, allowNull: true, references: { model: "users", key: "id" }, onDelete: "SET NULL",
  });
};

export const down: Migration = async ({ context: q }) => {
  await q.removeColumn("demo_tenants", "provisioned_user_id");
  await q.removeColumn("demo_tenants", "provisioned_org_id");
};
