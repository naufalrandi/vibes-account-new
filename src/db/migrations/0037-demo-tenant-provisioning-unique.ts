import type { Migration } from "../migrate";

/**
 * Schema-level guardrail: each real Organization/User should back at most one
 * DemoTenant. Nothing in application code can produce a duplicate today (every
 * provisioning call inserts a brand-new User), but nothing enforced the
 * invariant either — a unique index (Postgres correctly allows any number of
 * NULLs alongside it) closes that gap for good.
 */
export const up: Migration = async ({ context: q }) => {
  await q.addIndex("demo_tenants", ["provisioned_org_id"], { unique: true, name: "demo_tenants_provisioned_org_id_unique" });
  await q.addIndex("demo_tenants", ["provisioned_user_id"], { unique: true, name: "demo_tenants_provisioned_user_id_unique" });
};

export const down: Migration = async ({ context: q }) => {
  await q.removeIndex("demo_tenants", "demo_tenants_provisioned_user_id_unique");
  await q.removeIndex("demo_tenants", "demo_tenants_provisioned_org_id_unique");
};
