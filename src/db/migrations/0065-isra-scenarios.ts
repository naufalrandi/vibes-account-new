import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * ISRA + SoA (F-1-impl), Group E — Risk Register core (F-4), design doc §2.7:
 * `isra_scenarios` (the `israScenarios2` port — the anchor entity, §1.1),
 * its included-vulns and potential-impact junctions, Existing Controls +
 * their Annex A junction, and the 1:1 Current Risk row.
 *
 * `isra_scenarios.status` and `isra_existing_controls.status`/`.affects` are
 * STRING columns validated at the service layer (a later batch) against the
 * exported `as const` arrays below — the exact enum membership for
 * `ISRA_SCENARIO_STATUS`/`ISRA_TREATMENT_*` fields not spelled out verbatim
 * in the design doc is inferred from context (see the F-1-impl report) and
 * is not a DB-level constraint, matching this codebase's STRING-not-ENUM
 * convention (§2.2).
 */
export const up: Migration = async ({ context: q }) => {
  const ts = {
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  };

  await q.createTable("isra_scenarios", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: { type: DataTypes.UUID, allowNull: false, references: { model: "organizations", key: "id" }, onDelete: "CASCADE" },
    code: { type: DataTypes.STRING, allowNull: false, unique: true },
    primary_asset_ref: { type: DataTypes.STRING, allowNull: false },
    primary_asset_source: { type: DataTypes.STRING, allowNull: false },
    process_ref: { type: DataTypes.STRING, allowNull: true },
    secondary_asset_ref: { type: DataTypes.STRING, allowNull: false },
    secondary_asset_source: { type: DataTypes.STRING, allowNull: false },
    threat_id: { type: DataTypes.STRING, allowNull: false, references: { model: "isra_threat_library", key: "id" }, onDelete: "RESTRICT" },
    title: { type: DataTypes.STRING, allowNull: false },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Draft" },
    // Descriptive only — never an input to scoring (design doc §3.1).
    cia: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    impact_override: { type: DataTypes.JSONB, allowNull: true },
    inherent_l: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    eval_cycle: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    review_due: { type: DataTypes.DATEONLY, allowNull: true },
    created_by: { type: DataTypes.STRING, allowNull: true },
    activity: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    comments: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    ...ts,
  });
  await q.addIndex("isra_scenarios", ["org_id"]);
  await q.addIndex("isra_scenarios", ["threat_id"]);

  // Pure junction — matches the `element_requirement_xref` precedent: id +
  // two FKs, no timestamps.
  await q.createTable("isra_scenario_vulns", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    scenario_id: { type: DataTypes.UUID, allowNull: false, references: { model: "isra_scenarios", key: "id" }, onDelete: "CASCADE" },
    vuln_id: { type: DataTypes.STRING, allowNull: false, references: { model: "isra_vuln_library", key: "id" }, onDelete: "RESTRICT" },
  });
  await q.addIndex("isra_scenario_vulns", ["scenario_id", "vuln_id"], { unique: true });

  await q.createTable("isra_scenario_potential_impacts", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    scenario_id: { type: DataTypes.UUID, allowNull: false, references: { model: "isra_scenarios", key: "id" }, onDelete: "CASCADE" },
    area: { type: DataTypes.STRING, allowNull: false },
    severity: { type: DataTypes.INTEGER, allowNull: false },
    note: { type: DataTypes.TEXT, allowNull: false },
    ...ts,
  });
  await q.addIndex("isra_scenario_potential_impacts", ["scenario_id", "area"], { unique: true });

  await q.createTable("isra_existing_controls", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: { type: DataTypes.UUID, allowNull: false, references: { model: "organizations", key: "id" }, onDelete: "CASCADE" },
    scenario_id: { type: DataTypes.UUID, allowNull: false, references: { model: "isra_scenarios", key: "id" }, onDelete: "CASCADE" },
    title: { type: DataTypes.STRING, allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: true },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Planned" },
    affects: { type: DataTypes.STRING, allowNull: true },
    objective: { type: DataTypes.STRING, allowNull: true },
    ceff: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    maturity: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    maturity_by_ref: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    override_pct: { type: DataTypes.FLOAT, allowNull: true },
    verified: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    verified_effectiveness: { type: DataTypes.FLOAT, allowNull: true },
    evidence: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    created_by: { type: DataTypes.STRING, allowNull: true },
    ...ts,
  });
  await q.addIndex("isra_existing_controls", ["org_id"]);
  await q.addIndex("isra_existing_controls", ["scenario_id"]);

  await q.createTable("isra_existing_control_annex_refs", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    existing_control_id: { type: DataTypes.UUID, allowNull: false, references: { model: "isra_existing_controls", key: "id" }, onDelete: "CASCADE" },
    annex_ref: { type: DataTypes.STRING, allowNull: false, references: { model: "isra_annex_a_controls", key: "ref" }, onDelete: "RESTRICT" },
  });
  await q.addIndex("isra_existing_control_annex_refs", ["existing_control_id", "annex_ref"], { unique: true });
  await q.addIndex("isra_existing_control_annex_refs", ["annex_ref"]);

  // 1:1 with isra_scenarios — scenario_id IS the PK, no separate id column
  // (design doc §2.7: "scenario_id FK (PK, 1:1)").
  await q.createTable("isra_scenario_current_risk", {
    scenario_id: { type: DataTypes.UUID, primaryKey: true, references: { model: "isra_scenarios", key: "id" }, onDelete: "CASCADE" },
    method: { type: DataTypes.STRING, allowNull: false, defaultValue: "C-capped-quality-gated" },
    method_ver: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    calc_at: { type: DataTypes.DATE, allowNull: true },
    i_l: { type: DataTypes.INTEGER, allowNull: true },
    i_impact: { type: DataTypes.INTEGER, allowNull: true },
    suggested_l: { type: DataTypes.INTEGER, allowNull: true },
    suggested_impact: { type: DataTypes.INTEGER, allowNull: true },
    suggested_score: { type: DataTypes.INTEGER, allowNull: true },
    suggested_band: { type: DataTypes.STRING, allowNull: true },
    confirmed_l: { type: DataTypes.INTEGER, allowNull: true },
    confirmed_impact: { type: DataTypes.INTEGER, allowNull: true },
    confirmed_score: { type: DataTypes.INTEGER, allowNull: true },
    confirmed_band: { type: DataTypes.STRING, allowNull: true },
    confirmed_at: { type: DataTypes.DATE, allowNull: true },
    confirmed_by: { type: DataTypes.STRING, allowNull: true },
    override_rationale: { type: DataTypes.TEXT, allowNull: true },
    needs_review: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    eligible_control_ids: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    ...ts,
  });
};

export const down: Migration = async ({ context: q }) => {
  await q.dropTable("isra_scenario_current_risk");
  await q.dropTable("isra_existing_control_annex_refs");
  await q.dropTable("isra_existing_controls");
  await q.dropTable("isra_scenario_potential_impacts");
  await q.dropTable("isra_scenario_vulns");
  await q.dropTable("isra_scenarios");
};
