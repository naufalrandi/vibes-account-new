import type { Migration } from "../migrate";

/**
 * Fix G-1 / B-1: Scope implementation record code uniqueness per organization.
 * Widens the UNIQUE constraint from (module, code) to (org_id, module, code) so multiple tenants
 * can each maintain their own independent sequences (e.g. RISK-0001 per tenant).
 */
export const up: Migration = async ({ context: q }) => {
  await q.removeConstraint("implementation_records", "implementation_module_code_unique");
  await q.addConstraint("implementation_records", {
    fields: ["org_id", "module", "code"],
    type: "unique",
    name: "implementation_org_module_code_unique",
  });
};

export const down: Migration = async ({ context: q }) => {
  await q.removeConstraint("implementation_records", "implementation_org_module_code_unique");
  await q.addConstraint("implementation_records", {
    fields: ["module", "code"],
    type: "unique",
    name: "implementation_module_code_unique",
  });
};
