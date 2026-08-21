import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * ISRA + SoA (F-1-impl), Group F part 2 — Projected/Actual/rolling Residual +
 * Closure (all 1:1 with a scenario), scenario Cycles (frozen JSONB
 * snapshots), Initiatives + their scenario junction, and the versioned
 * Appetite log (design doc §2.8 rows 8–15).
 *
 * Per design doc §3.8, Projected/Actual/Residual all coexist in the live
 * code — Residual is an *addition*, not a strict replacement of
 * Projected/Actual, despite `isra-spec.md`'s superseded-model note. All
 * three are ported.
 */
export const up: Migration = async ({ context: q }) => {
  const ts = {
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  };

  // 1:1 with isra_scenarios — scenario_id IS the PK on all three residual
  // stage tables plus closure, per design doc §2.8.
  await q.createTable("isra_scenario_projected_residual", {
    scenario_id: { type: DataTypes.UUID, primaryKey: true, references: { model: "isra_scenarios", key: "id" }, onDelete: "CASCADE" },
    suggested_l: { type: DataTypes.INTEGER, allowNull: true },
    suggested_impact: { type: DataTypes.INTEGER, allowNull: true },
    suggested_score: { type: DataTypes.INTEGER, allowNull: true },
    suggested_band: { type: DataTypes.STRING, allowNull: true },
    confirmed_l: { type: DataTypes.INTEGER, allowNull: true },
    confirmed_impact: { type: DataTypes.INTEGER, allowNull: true },
    confirmed_score: { type: DataTypes.INTEGER, allowNull: true },
    confirmed_band: { type: DataTypes.STRING, allowNull: true },
    rtp_version: { type: DataTypes.INTEGER, allowNull: true },
    adequacy: { type: DataTypes.JSONB, allowNull: true },
    confirmed_at: { type: DataTypes.DATE, allowNull: true },
    confirmed_by: { type: DataTypes.STRING, allowNull: true },
    needs_review: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    ...ts,
  });

  await q.createTable("isra_scenario_actual_residual", {
    scenario_id: { type: DataTypes.UUID, primaryKey: true, references: { model: "isra_scenarios", key: "id" }, onDelete: "CASCADE" },
    suggested_l: { type: DataTypes.INTEGER, allowNull: true },
    suggested_impact: { type: DataTypes.INTEGER, allowNull: true },
    suggested_score: { type: DataTypes.INTEGER, allowNull: true },
    suggested_band: { type: DataTypes.STRING, allowNull: true },
    confirmed_l: { type: DataTypes.INTEGER, allowNull: true },
    confirmed_impact: { type: DataTypes.INTEGER, allowNull: true },
    confirmed_score: { type: DataTypes.INTEGER, allowNull: true },
    confirmed_band: { type: DataTypes.STRING, allowNull: true },
    verified_control_ids: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    adequacy: { type: DataTypes.JSONB, allowNull: true },
    confirmed_at: { type: DataTypes.DATE, allowNull: true },
    confirmed_by: { type: DataTypes.STRING, allowNull: true },
    needs_review: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    ...ts,
  });

  await q.createTable("isra_scenario_residual", {
    scenario_id: { type: DataTypes.UUID, primaryKey: true, references: { model: "isra_scenarios", key: "id" }, onDelete: "CASCADE" },
    score: { type: DataTypes.INTEGER, allowNull: true },
    band: { type: DataTypes.STRING, allowNull: true },
    basis: { type: DataTypes.STRING, allowNull: true },
    assessment_date: { type: DataTypes.DATEONLY, allowNull: true },
    assessed_by: { type: DataTypes.STRING, allowNull: true },
    notes: { type: DataTypes.TEXT, allowNull: true },
    ...ts,
  });

  await q.createTable("isra_scenario_closure", {
    scenario_id: { type: DataTypes.UUID, primaryKey: true, references: { model: "isra_scenarios", key: "id" }, onDelete: "CASCADE" },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Open" },
    closed_at: { type: DataTypes.DATE, allowNull: true },
    closed_by: { type: DataTypes.STRING, allowNull: true },
    reason: { type: DataTypes.TEXT, allowNull: true },
    ...ts,
  });

  // Frozen historical snapshots — deliberately a JSONB blob, not further
  // normalized (design doc §2.8: "these are frozen historical records, never
  // queried by inner field").
  await q.createTable("isra_scenario_cycles", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    scenario_id: { type: DataTypes.UUID, allowNull: false, references: { model: "isra_scenarios", key: "id" }, onDelete: "CASCADE" },
    cycle_number: { type: DataTypes.INTEGER, allowNull: false },
    snapshot: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    archived_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
  await q.addIndex("isra_scenario_cycles", ["scenario_id"]);
  await q.addIndex("isra_scenario_cycles", ["scenario_id", "cycle_number"], { unique: true });

  await q.createTable("isra_initiatives", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: { type: DataTypes.UUID, allowNull: false, references: { model: "organizations", key: "id" }, onDelete: "CASCADE" },
    code: { type: DataTypes.STRING, allowNull: false, unique: true },
    title: { type: DataTypes.STRING, allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: true },
    owner: { type: DataTypes.STRING, allowNull: true },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Draft" },
    ...ts,
  });
  await q.addIndex("isra_initiatives", ["org_id"]);

  await q.createTable("isra_initiative_scenarios", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    initiative_id: { type: DataTypes.UUID, allowNull: false, references: { model: "isra_initiatives", key: "id" }, onDelete: "CASCADE" },
    scenario_id: { type: DataTypes.UUID, allowNull: false, references: { model: "isra_scenarios", key: "id" }, onDelete: "CASCADE" },
  });
  await q.addIndex("isra_initiative_scenarios", ["initiative_id", "scenario_id"], { unique: true });
  await q.addIndex("isra_initiative_scenarios", ["scenario_id"]);

  // Versioned, append-only history — never a singleton (design doc §2.8).
  await q.createTable("isra_appetite_log", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: { type: DataTypes.UUID, allowNull: false, references: { model: "organizations", key: "id" }, onDelete: "CASCADE" },
    version: { type: DataTypes.INTEGER, allowNull: false },
    threshold: { type: DataTypes.INTEGER, allowNull: false },
    effective_date: { type: DataTypes.DATEONLY, allowNull: true },
    approved_by: { type: DataTypes.STRING, allowNull: true },
    approval_date: { type: DataTypes.DATEONLY, allowNull: true },
    rationale: { type: DataTypes.TEXT, allowNull: true },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
  await q.addIndex("isra_appetite_log", ["org_id"]);
};

export const down: Migration = async ({ context: q }) => {
  await q.dropTable("isra_appetite_log");
  await q.dropTable("isra_initiative_scenarios");
  await q.dropTable("isra_initiatives");
  await q.dropTable("isra_scenario_cycles");
  await q.dropTable("isra_scenario_closure");
  await q.dropTable("isra_scenario_residual");
  await q.dropTable("isra_scenario_actual_residual");
  await q.dropTable("isra_scenario_projected_residual");
};
