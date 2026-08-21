import type { Migration } from "../migrate";

/**
 * Widens ISRA code unique constraints (isra_scenarios, isra_evidence,
 * isra_scenario_templates, isra_initiatives) from global unique to
 * composite per-tenant unique (org_id, code). Resolves G-96 and G-97.
 */
export const up: Migration = async ({ context: q }) => {
  const tables = [
    { table: "isra_scenarios", constraint: "isra_scenarios_code_key", index: "isra_scenarios_org_code_unique" },
    { table: "isra_evidence", constraint: "isra_evidence_code_key", index: "isra_evidence_org_code_unique" },
    { table: "isra_scenario_templates", constraint: "isra_scenario_templates_code_key", index: "isra_scenario_templates_org_code_unique" },
    { table: "isra_initiatives", constraint: "isra_initiatives_code_key", index: "isra_initiatives_org_code_unique" },
  ];

  for (const item of tables) {
    await q.sequelize.query(`ALTER TABLE "${item.table}" DROP CONSTRAINT IF EXISTS "${item.constraint}"`);
    await q.addIndex(item.table, ["org_id", "code"], {
      unique: true,
      name: item.index,
    });
  }
};

export const down: Migration = async ({ context: q }) => {
  const tables = [
    { table: "isra_scenarios", constraint: "isra_scenarios_code_key", index: "isra_scenarios_org_code_unique" },
    { table: "isra_evidence", constraint: "isra_evidence_code_key", index: "isra_evidence_org_code_unique" },
    { table: "isra_scenario_templates", constraint: "isra_scenario_templates_code_key", index: "isra_scenario_templates_org_code_unique" },
    { table: "isra_initiatives", constraint: "isra_initiatives_code_key", index: "isra_initiatives_org_code_unique" },
  ];

  for (const item of tables) {
    await q.removeIndex(item.table, item.index);
    await q.sequelize.query(`ALTER TABLE "${item.table}" ADD CONSTRAINT "${item.constraint}" UNIQUE ("code")`);
  }
};
